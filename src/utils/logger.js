const winston = require('winston');
const { maskPII } = require('./piiMasker');

// Custom format for masking PII
const piiMaskingFormat = winston.format((info) => {
  if (info.data) {
    info.data = maskPII(info.data);
  }
  if (info.body) {
    info.body = maskPII(info.body);
  }
  if (info.params) {
    info.params = maskPII(info.params);
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    piiMaskingFormat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'appointment-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          const corrId = correlationId ? `[${correlationId}]` : '';
          return `${timestamp} ${level} ${corrId} ${message} ${metaStr}`;
        })
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

module.exports = logger;
