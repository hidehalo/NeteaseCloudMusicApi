const fs = require('fs')
const path = require('path')
const express = require('express')
const packageJSON = require('./package.json')
const exec = require('child_process').exec
const cache = require('./util/apicache').middleware
const { cookieToJson } = require('./util/index')
const fileUpload = require('express-fileupload')
const decode = require('safe-decode-uri-component')
import { SongDownloadQueue } from './lib/queue'
import { StaticIpRequest } from './lib/http'
import { ServerContext } from './lib/context'
import { transports, format, createLogger } from 'winston'
import { fileTrace } from './lib/logger/format'
import generateConfig from './generateConfig'
require('dotenv').config()
const { createBullBoard } = require('@bull-board/api')
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter')
const { ExpressAdapter } = require('@bull-board/express')
const ipUtil = require('ip')

/**
 * The version check result.
 * @readonly
 * @enum {number}
 */
const VERSION_CHECK_RESULT = {
  FAILED: -1,
  NOT_LATEST: 0,
  LATEST: 1,
}

/**
 * @typedef {{
 *   identifier?: string,
 *   route: string,
 *   module: any
 * }} ModuleDefinition
 */

/**
 * @typedef {{
 *   port?: number,
 *   host?: string,
 *   checkVersion?: boolean,
 *   moduleDefs?: ModuleDefinition[]
 * }} NcmApiOptions
 */

/**
 * @typedef {{
 *   status: VERSION_CHECK_RESULT,
 *   ourVersion?: string,
 *   npmVersion?: string,
 * }} VersionCheckResult
 */

/**
 * @typedef {{
 *  server?: import('http').Server,
 * }} ExpressExtension
 */

/**
 * Get the module definitions dynamically.
 *
 * @param {Express} app
 * @param {string} modulesPath The path to modules (JS).
 * @param {Record<string, string>} [specificRoute] The specific route of specific modules.
 * @param {boolean} [doRequire] If true, require() the module directly.
 * Otherwise, print out the module path. Default to true.
 * @returns {Promise<ModuleDefinition[]>} The module definitions.
 *
 * @example getModuleDefinitions("./module", {"album_new.js": "/album/create"})
 */
async function getModulesDefinitions(
  app,
  modulesPath,
  specificRoute,
  doRequire = true,
) {
  const files = await fs.promises.readdir(modulesPath)
  const parseRoute = (/** @type {string} */ fileName) =>
    specificRoute && fileName in specificRoute
      ? specificRoute[fileName]
      : `/${fileName.replace(/\.js$/i, '').replace(/_/g, '/')}`

  const modules = files
    .reverse()
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const identifier = file.split('.').shift()
      const route = parseRoute(file)
      const modulePath = path.join(modulesPath, file)
      const module = doRequire ? require(modulePath) : modulePath

      return { identifier, route, module, app }
    })

  return modules
}

/**
 * Check if the version of this API is latest.
 *
 * @returns {Promise<VersionCheckResult>} If true, this API is up-to-date;
 * otherwise, this API should be upgraded and you would
 * need to notify users to upgrade it manually.
 */
async function checkVersion() {
  return new Promise((resolve) => {
    exec('npm info NeteaseCloudMusicApi version', (err, stdout) => {
      if (!err) {
        let version = stdout.trim()

        /**
         * @param {VERSION_CHECK_RESULT} status
         */
        const resolveStatus = (status) =>
          resolve({
            status,
            ourVersion: packageJSON.version,
            npmVersion: version,
          })

        resolveStatus(
          packageJSON.version < version
            ? VERSION_CHECK_RESULT.NOT_LATEST
            : VERSION_CHECK_RESULT.LATEST,
        )
      }
    })

    resolve({
      status: VERSION_CHECK_RESULT.FAILED,
    })
  })
}

/**
 * Construct the server of NCM API.
 *
 * @param {ModuleDefinition[]} [moduleDefs] Customized module definitions [advanced]
 * @returns {Promise<import("express").Express>} The server instance.
 */
async function consturctServer(moduleDefs) {
  const app = express()
  app.set('trust proxy', true)

  /**
   * CORS & Preflight request
   */
  app.use((req, res, next) => {
    if (
      req.path !== '/' &&
      !req.path.includes('.') &&
      !req.path.includes('/admin')
    ) {
      const capitalizeFirstLetter = (string) => {
        return string.charAt(0).toUpperCase() + string.slice(1)
      }
      let allowHeaders = Object.keys(req.headers)
      allowHeaders.push(...['X-Requested-With', 'Content-Type', 'X-XSRF-TOKEN'])
      for (let i = 0; i < allowHeaders.length; i++) {
        let prepareToUpper = allowHeaders[i].split('-')
        let upper = []
        for (let j = 0; j < prepareToUpper.length; j++) {
          upper.push(capitalizeFirstLetter(prepareToUpper[j]))
        }
        allowHeaders[i] = upper.join('-')
      }
      res.set({
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Headers':
          allowHeaders.join(',') || 'X-Requested-With,Content-Type',
        'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
      })
    }
    req.method === 'OPTIONS' ? res.status(204).end() : next()
  })

  /**
   * Cookie Parser
   */
  app.use((req, _, next) => {
    req.cookies = {}
    //;(req.headers.cookie || '').split(/\s*;\s*/).forEach((pair) => { //  Polynomial regular expression //
    ;(req.headers.cookie || '').split(/;\s+|(?<!\s)\s+$/g).forEach((pair) => {
      let crack = pair.indexOf('=')
      if (crack < 1 || crack == pair.length - 1) return
      req.cookies[decode(pair.slice(0, crack)).trim()] = decode(
        pair.slice(crack + 1),
      ).trim()
    })
    next()
  })

  /**
   * Body Parser and File Upload
   */
  app.use(express.json())

  app.use(express.urlencoded({ extended: false }))

  app.use(fileUpload())

  /**
   * Serving static files
   */
  app.use(express.static(path.join(__dirname, 'public')))

  /**
   * Cache
   */
  app.use(cache('2 minutes', (_, res) => res.statusCode === 200))

  /**
   * Special Routers
   */
  const special = {
    'daily_signin.js': '/daily_signin',
    'fm_trash.js': '/fm_trash',
    'personal_fm.js': '/personal_fm',
  }

  /**
   * Load every modules in this directory
   */
  const moduleDefinitions =
    moduleDefs ||
    (await getModulesDefinitions(app, path.join(__dirname, 'module'), special))

  for (const moduleDef of moduleDefinitions) {
    // Register the route.
    app.use(moduleDef.route, async (req, res) => {
      ;[req.query, req.body].forEach((item) => {
        if (typeof item.cookie === 'string') {
          item.cookie = cookieToJson(decode(item.cookie))
        }
      })

      let query = Object.assign(
        {},
        { cookie: req.cookies },
        req.query,
        req.body,
        req.files,
      )
      try {
        let ip = ipUtil.address()
        let staticIpReq = new StaticIpRequest(app.get('context'), ip)
        query.ip = staticIpReq.ip
        const moduleResponse = await moduleDef.module(
          query,
          staticIpReq.send.bind(staticIpReq),
          moduleDef.app,
        )
        let logger = app.get('logger')
        logger.info('[OK]' + decode(req.originalUrl))

        const cookies = moduleResponse.cookie
        if (Array.isArray(cookies) && cookies.length > 0) {
          if (req.protocol === 'https') {
            // Try to fix CORS SameSite Problem
            res.append(
              'Set-Cookie',
              cookies.map((cookie) => {
                return cookie + '; SameSite=None; Secure'
              }),
            )
          } else {
            res.append('Set-Cookie', cookies)
          }
        }
        res.status(moduleResponse.status).send(moduleResponse.body)
      } catch (/** @type {*} */ moduleResponse) {
        let logger = app.get('logger')
        logger.error('[ERR]' + decode(req.originalUrl), {
          feedback: moduleResponse,
        })
        if (!moduleResponse.body) {
          res.status(404).send({
            code: 404,
            data: null,
            msg: 'Not Found',
          })
          return
        }
        if (moduleResponse.body.code == '301')
          moduleResponse.body.msg = '需要登录'
        res.append('Set-Cookie', moduleResponse.cookie)
        res.status(moduleResponse.status).send(moduleResponse.body)
      }
    })
  }

  return app
}

function buildLogger() {
  let logLevel = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'debug'
  return createLogger({
    level: logLevel,
    transports: [
      new transports.File({
        filename: 'logs/server.log',
        level: logLevel,
        format: format.combine(
          format.timestamp({ format: 'YYYY-MMM-DD HH:mm:ss' }),
          format.logstash(),
          format.errors(),
          // format(fileTrace)(),
        ),
      }),
    ],
  })
}

/**
 * Serve the NCM API.
 * @param {NcmApiOptions} options
 * @returns {Promise<import('express').Express & ExpressExtension>}
 */
async function serveNcmApi(options) {
  const logger = buildLogger()
  let context = new ServerContext(logger)
  logger.debug('服务器启动中...')
  const port = Number(options.port || process.env.PORT || '3000')
  const host = options.host || process.env.HOST || ''

  const checkVersionSubmission =
    options.checkVersion &&
    checkVersion().then(({ npmVersion, ourVersion, status }) => {
      if (status == VERSION_CHECK_RESULT.NOT_LATEST) {
        console.log(
          `最新版本: ${npmVersion}, 当前版本: ${ourVersion}, 请及时更新`,
        )
      }
    })

  const constructServerSubmission = consturctServer(options.moduleDefs)

  const [_, app] = await Promise.all([
    checkVersionSubmission,
    constructServerSubmission,
  ])

  // Graceful shutdown
  let gracefulShutdownLock = false
  const gracefulShutdown = async () => {
    if (gracefulShutdownLock) {
      console.log('server is closing, please wait a moment!')
      return
    }
    console.log('server is closing...')
    gracefulShutdownLock = true
    const timeoutTimer = new Promise((resolve) => {
      setTimeout(() => {
        console.log('server is blocking, try to force quit.')
        resolve(true)
      }, 60 * 1e3)
    })
    const shutdownProcedure = new Promise((resolve) => {
      logger.debug('服务开始关闭...')
      context.emit('done')
      resolve(true)
    })
    await Promise.race([timeoutTimer, shutdownProcedure])
    process.exit(0)
  }
  process.on('SIGINT', gracefulShutdown)
  process.on('SIGTERM', gracefulShutdown)

  // if (process.env.ANONYMOUS) {
  //   await generateConfig()
  // }

  // Task queue
  const dq = new SongDownloadQueue(context, process.env.DOWNLOAD_DIR, {
    concurrency: process.env.QUEUE_WORKER_LIMIT,
    taskTimeoutMicroTs: process.env.QUEUE_TASK_TIME,
  })
  dq.start()

  // Dependency inject
  app.set('downloadQueue', dq)
  app.set('logger', logger)
  app.set('context', context)

  // BullMQ dashboard HTTP Service
  const serverAdapter = new ExpressAdapter()
  const basePath = '/admin/queues'
  serverAdapter.setBasePath(basePath)
  const queues = [
    new BullMQAdapter(dq.queueDelegate, {
      allowRetries: false,
      readOnlyMode: true,
    }),
  ]
  createBullBoard({
    queues,
    serverAdapter,
  })
  app.use(basePath, serverAdapter.getRouter())

  // HTTP Service
  /** @type {import('express').Express & ExpressExtension} */
  const appExt = app
  appExt.server = app.listen(port, host, () => {
    console.log(`server running @ http://${host ? host : 'localhost'}:${port}`)
    context.logger.debug('服务启动成功')
  })
  context.once('done', () => {
    appExt.server.close(() => {
      logger.debug('HTTP 网络服务已关闭')
    })
  })

  return appExt
}

module.exports = {
  serveNcmApi,
  getModulesDefinitions,
}
