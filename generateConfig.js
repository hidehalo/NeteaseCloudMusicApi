const fs = require('fs')
const { register_anonimous } = require('./main')
const { cookieToJson } = require('./util/index')
const path = require('path')
const token = require('./database/token.json')

async function generateConfig() {
  console.log('generate!!!')
  try {
    const res = await register_anonimous()
    const cookie = res.body.cookie
    if (cookie) {
      const cookieObj = cookieToJson(cookie)
      let newToken = { ...token }
      newToken.anonymous_token = cookieObj.MUSIC_A
      fs.writeFileSync(
        path.resolve(__dirname, 'database/token.json'),
        JSON.stringify(newToken, null, 2),
        'utf-8',
      )
    }
  } catch (error) {
    console.log(error)
  }
}
module.exports = generateConfig
