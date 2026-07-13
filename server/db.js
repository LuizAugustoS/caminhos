import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://caminhos:caminhos@localhost:5432/caminhos',
  max: 10,
});

export const query = (text, params) => pool.query(text, params);
