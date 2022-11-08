/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('songs', function (table) {
    table.boolean('uploaded').defaultTo(false).comment('是否已上传到云盘')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('songs', function (table) {
    table.dropColumn('uploaded')
  })
}
