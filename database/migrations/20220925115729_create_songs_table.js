/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('songs', (table) => {
    table.string('songId', 64)
    table.string('songName')
    table.string('coverUrl')
    table.integer('trackNumber')
    table.string('albumName')
    table.text('artistsName')
    table.string('sourceUrl')
    table.text('sourceChecksum')
    table.bigint('sourceFileSize')
    table.string('targetPath')
    table.text('targetChecksum')
    table.bigint('targetFileSize')
    table.string('state')
    table.text('stateDesc')
    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.primary('songId')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('songs')
}
