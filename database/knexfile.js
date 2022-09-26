/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: __dirname + '/dev.sqlite3',
    },
    useNullAsDefault: true,
  },

  staging: {
    client: 'better-sqlite3',
    connection: {
      filename: __dirname + '/stag.sqlite3',
    },
    useNullAsDefault: true,
  },

  production: {
    client: 'better-sqlite3',
    connection: {
      filename: __dirname + '/prod.sqlite3',
    },
    useNullAsDefault: true,
  },
}
