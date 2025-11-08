const Joi = require('joi');
const { AppError } = require('./errorHandler');

const schemas = {
  bookAppointment: Joi.object({
    patient_id: Joi.number().integer().positive().required(),
    doctor_id: Joi.number().integer().positive().required(),
    appointment_date: Joi.date().min('now').required(),
    start_time: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).required(),
    end_time: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).required(),
    reason: Joi.string().max(500).optional(),
    notes: Joi.string().max(1000).optional()
  }),

  rescheduleAppointment: Joi.object({
    appointment_date: Joi.date().min('now').required(),
    start_time: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).required(),
    end_time: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).required(),
    reason: Joi.string().max(500).optional()
  }),

  cancelAppointment: Joi.object({
    reason: Joi.string().max(500).optional()
  }),

  completeAppointment: Joi.object({
    notes: Joi.string().max(1000).optional()
  }),

  searchQuery: Joi.object({
    patient_id: Joi.number().integer().positive(),
    doctor_id: Joi.number().integer().positive(),
    status: Joi.string().valid('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'),
    date: Joi.date(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10)
  })
};

const validate = (schemaName) => {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) {
      return next(new AppError('Validation schema not found', 500));
    }

    const dataToValidate = req.method === 'GET' ? req.query : req.body;
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const message = error.details.map(detail => detail.message).join(', ');
      return next(new AppError(message, 400, 'VALIDATION_ERROR'));
    }

    if (req.method === 'GET') {
      req.query = value;
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = { validate };
