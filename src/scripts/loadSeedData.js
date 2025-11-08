require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

const loadSeedData = async () => {
  const client = await pool.connect();
  try {
    logger.info('Loading seed data for appointments...');

    // Read CSV file
    const csvPath = path.join(__dirname, '../../../shared/seed-data/hms_appointments.csv');

    if (!fs.existsSync(csvPath)) {
      logger.warn('Seed data file not found, skipping seed data load');
      return;
    }

    const csvData = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');

    // Skip header and process each line
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const [appointment_id, patient_id, doctor_id, appointment_date, start_time, end_time, status, reason, created_at] = values;

      await client.query(
        `INSERT INTO appointments (appointment_id, patient_id, doctor_id, appointment_date, start_time, end_time, status, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [appointment_id, patient_id, doctor_id, appointment_date, start_time, end_time, status, reason, created_at]
      );
    }

    logger.info(`Loaded ${lines.length - 1} appointments from seed data`);
  } catch (error) {
    logger.error('Failed to load seed data', { error: error.message });
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

loadSeedData()
  .then(() => {
    logger.info('Seed data loaded successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Failed to load seed data', { error: error.message });
    process.exit(1);
  });
