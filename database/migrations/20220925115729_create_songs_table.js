/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('songs', (table) => {
    table.increments()
    table.string('songId')
    table.string('sourceUrl')
    table.string('sourceChecksum')
    table.bigint('sourceFileSize')
    table.string('targetPath')
    table.string('targetChecksum')
    table.bigint('targetFileSize')
    table.string('state')
    table.timestamp('createdAt').defaultTo(knex.fn.now())
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('songs')
}
