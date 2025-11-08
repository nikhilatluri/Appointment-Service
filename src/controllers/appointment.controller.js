const { pool } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const axios = require('axios');

const PATIENT_SERVICE_URL = process.env.PATIENT_SERVICE_URL || 'http://localhost:3001';
const DOCTOR_SERVICE_URL = process.env.DOCTOR_SERVICE_URL || 'http://localhost:3002';
const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://localhost:3004';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3007';

class AppointmentController {
  // Validate patient exists
  async validatePatient(patientId) {
    try {
      const response = await axios.get(`${PATIENT_SERVICE_URL}/v1/patients/${patientId}`);
      return response.data.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new AppError('Patient not found', 404, 'PATIENT_NOT_FOUND');
      }
      throw new AppError('Failed to validate patient', 503, 'SERVICE_UNAVAILABLE');
    }
  }

  // Validate doctor exists
  async validateDoctor(doctorId) {
    try {
      const response = await axios.get(`${DOCTOR_SERVICE_URL}/v1/doctors/${doctorId}`);
      return response.data.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new AppError('Doctor not found', 404, 'DOCTOR_NOT_FOUND');
      }
      throw new AppError('Failed to validate doctor', 503, 'SERVICE_UNAVAILABLE');
    }
  }

  // Check for slot conflicts
  async checkSlotConflict(doctorId, appointmentDate, startTime, endTime, excludeAppointmentId = null) {
    const query = excludeAppointmentId
      ? `SELECT * FROM appointments
         WHERE doctor_id = $1
         AND appointment_date = $2
         AND status NOT IN ('CANCELLED', 'COMPLETED')
         AND appointment_id != $3
         AND (
           (start_time < $5 AND end_time > $4) OR
           (start_time >= $4 AND start_time < $5)
         )`
      : `SELECT * FROM appointments
         WHERE doctor_id = $1
         AND appointment_date = $2
         AND status NOT IN ('CANCELLED', 'COMPLETED')
         AND (
           (start_time < $4 AND end_time > $3) OR
           (start_time >= $3 AND start_time < $4)
         )`;

    const params = excludeAppointmentId
      ? [doctorId, appointmentDate, excludeAppointmentId, startTime, endTime]
      : [doctorId, appointmentDate, startTime, endTime];

    const result = await pool.query(query, params);
    return result.rows.length > 0;
  }

  // Send notification
  async sendNotification(type, patientId, data) {
    try {
      await axios.post(`${NOTIFICATION_SERVICE_URL}/v1/notifications`, {
        type,
        patient_id: patientId,
        message: data.message,
        metadata: data
      });
    } catch (error) {
      logger.warn('Failed to send notification', { error: error.message, type });
    }
  }

  async bookAppointment(req, res, next) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { patient_id, doctor_id, appointment_date, start_time, end_time, reason, notes } = req.body;

      // Validate patient and doctor
      const patient = await this.validatePatient(patient_id);
      const doctor = await this.validateDoctor(doctor_id);

      // Check if appointment is in the future
      const appointmentDateTime = new Date(`${appointment_date}T${start_time}`);
      if (appointmentDateTime <= new Date()) {
        throw new AppError('Appointment must be in the future', 400, 'INVALID_DATE');
      }

      // Check for slot conflicts
      const hasConflict = await this.checkSlotConflict(doctor_id, appointment_date, start_time, end_time);
      if (hasConflict) {
        throw new AppError('Time slot not available', 409, 'SLOT_CONFLICT');
      }

      // Create appointment
      const result = await client.query(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, start_time, end_time, reason, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SCHEDULED')
         RETURNING *`,
        [patient_id, doctor_id, appointment_date, start_time, end_time, reason, notes]
      );

      const appointment = result.rows[0];

      await client.query('COMMIT');

      // Send notification
      this.sendNotification('APPOINTMENT_CONFIRMATION', patient_id, {
        message: `Appointment confirmed with ${doctor.name} on ${appointment_date} at ${start_time}`,
        appointmentId: appointment.appointment_id,
        doctorName: doctor.name,
        date: appointment_date,
        time: start_time
      });

      logger.info('Appointment booked', {
        correlationId: req.correlationId,
        appointmentId: appointment.appointment_id,
        patientId: patient_id,
        doctorId: doctor_id
      });

      res.status(201).json({
        success: true,
        data: appointment,
        correlationId: req.correlationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }

  async rescheduleAppointment(req, res, next) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { appointment_date, start_time, end_time, reason } = req.body;

      // Get existing appointment
      const existingResult = await client.query(
        'SELECT * FROM appointments WHERE appointment_id = $1',
        [id]
      );

      if (existingResult.rows.length === 0) {
        throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
      }

      const existing = existingResult.rows[0];

      if (existing.status === 'CANCELLED' || existing.status === 'COMPLETED') {
        throw new AppError('Cannot reschedule cancelled or completed appointment', 400, 'INVALID_STATUS');
      }

      // Check reschedule count
      if (existing.reschedule_count >= 2) {
        throw new AppError('Maximum reschedule limit reached (2)', 400, 'MAX_RESCHEDULE_EXCEEDED');
      }

      // Check 1 hour cutoff
      const existingDateTime = new Date(`${existing.appointment_date}T${existing.start_time}`);
      const now = new Date();
      const hoursDiff = (existingDateTime - now) / (1000 * 60 * 60);

      if (hoursDiff < 1) {
        throw new AppError('Cannot reschedule within 1 hour of appointment', 400, 'CUTOFF_TIME_EXCEEDED');
      }

      // Check new time slot
      const newDateTime = new Date(`${appointment_date}T${start_time}`);
      if (newDateTime <= new Date()) {
        throw new AppError('New appointment time must be in the future', 400, 'INVALID_DATE');
      }

      // Check for conflicts
      const hasConflict = await this.checkSlotConflict(
        existing.doctor_id,
        appointment_date,
        start_time,
        end_time,
        id
      );

      if (hasConflict) {
        throw new AppError('New time slot not available', 409, 'SLOT_CONFLICT');
      }

      // Update appointment
      const result = await client.query(
        `UPDATE appointments
         SET appointment_date = $1, start_time = $2, end_time = $3,
             reschedule_count = reschedule_count + 1,
             notes = CONCAT(COALESCE(notes, ''), E'\nRescheduled: ', $4),
             updated_at = CURRENT_TIMESTAMP,
             version = version + 1
         WHERE appointment_id = $5
         RETURNING *`,
        [appointment_date, start_time, end_time, reason || 'No reason provided', id]
      );

      await client.query('COMMIT');

      const appointment = result.rows[0];

      // Send notification
      this.sendNotification('APPOINTMENT_RESCHEDULED', appointment.patient_id, {
        message: `Appointment rescheduled to ${appointment_date} at ${start_time}`,
        appointmentId: appointment.appointment_id,
        date: appointment_date,
        time: start_time
      });

      logger.info('Appointment rescheduled', {
        correlationId: req.correlationId,
        appointmentId: id,
        rescheduleCount: appointment.reschedule_count
      });

      res.json({
        success: true,
        data: appointment,
        correlationId: req.correlationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }

  async cancelAppointment(req, res, next) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { reason } = req.body;

      // Get appointment
      const result = await client.query(
        'SELECT * FROM appointments WHERE appointment_id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
      }

      const appointment = result.rows[0];

      if (appointment.status === 'CANCELLED') {
        throw new AppError('Appointment already cancelled', 400, 'ALREADY_CANCELLED');
      }

      if (appointment.status === 'COMPLETED') {
        throw new AppError('Cannot cancel completed appointment', 400, 'INVALID_STATUS');
      }

      // Update status
      const updateResult = await client.query(
        `UPDATE appointments
         SET status = 'CANCELLED',
             notes = CONCAT(COALESCE(notes, ''), E'\nCancelled: ', COALESCE($1::text, 'No reason provided')),
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment_id = $2
         RETURNING *`,
        [reason, id]
      );

      const cancelledAppointment = updateResult.rows[0];

      // Calculate refund policy
      const appointmentDateTime = new Date(`${appointment.appointment_date}T${appointment.start_time}`);
      const now = new Date();
      const hoursDiff = (appointmentDateTime - now) / (1000 * 60 * 60);

      let refundPolicy = 'NO_REFUND';
      if (hoursDiff >= 24) {
        refundPolicy = 'FULL_REFUND';
      } else if (hoursDiff >= 6) {
        refundPolicy = 'PARTIAL_REFUND';
      } else {
        refundPolicy = 'CANCELLATION_FEE';
      }

      await client.query('COMMIT');

      // Notify billing service
      try {
        await axios.post(`${BILLING_SERVICE_URL}/v1/bills/cancel`, {
          appointment_id: id,
          refund_policy: refundPolicy
        });
      } catch (error) {
        logger.warn('Failed to notify billing service', { error: error.message });
      }

      // Send notification
      this.sendNotification('CANCELLATION', appointment.patient_id, {
        message: `Appointment cancelled. Refund policy: ${refundPolicy}`,
        appointmentId: id,
        refundPolicy
      });

      logger.info('Appointment cancelled', {
        correlationId: req.correlationId,
        appointmentId: id,
        refundPolicy
      });

      res.json({
        success: true,
        data: cancelledAppointment,
        refundPolicy,
        correlationId: req.correlationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }

  async completeAppointment(req, res, next) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { notes } = req.body;

      // Get appointment
      const result = await client.query(
        'SELECT * FROM appointments WHERE appointment_id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
      }

      const appointment = result.rows[0];

      if (appointment.status !== 'SCHEDULED') {
        throw new AppError('Only scheduled appointments can be completed', 400, 'INVALID_STATUS');
      }

      // Update status
      const updateResult = await client.query(
        `UPDATE appointments
         SET status = 'COMPLETED',
             notes = CONCAT(COALESCE(notes, ''), E'\nCompletion notes: ', COALESCE($1::text, 'No notes')),
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment_id = $2
         RETURNING *`,
        [notes, id]
      );

      const completedAppointment = updateResult.rows[0];

      await client.query('COMMIT');

      // Trigger billing
      try {
        await axios.post(`${BILLING_SERVICE_URL}/v1/bills`, {
          appointment_id: id,
          patient_id: appointment.patient_id,
          doctor_id: appointment.doctor_id,
          amount: 500.00 // Base consultation fee
        });
      } catch (error) {
        logger.warn('Failed to generate bill', { error: error.message });
      }

      logger.info('Appointment completed', {
        correlationId: req.correlationId,
        appointmentId: id
      });

      res.json({
        success: true,
        data: completedAppointment,
        correlationId: req.correlationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }

  async markNoShow(req, res, next) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Get appointment
      const result = await client.query(
        'SELECT * FROM appointments WHERE appointment_id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
      }

      const appointment = result.rows[0];

      if (appointment.status !== 'SCHEDULED') {
        throw new AppError('Only scheduled appointments can be marked as no-show', 400, 'INVALID_STATUS');
      }

      // Update status
      const updateResult = await client.query(
        `UPDATE appointments
         SET status = 'NO_SHOW',
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment_id = $1
         RETURNING *`,
        [id]
      );

      await client.query('COMMIT');

      // Apply no-show fee
      try {
        await axios.post(`${BILLING_SERVICE_URL}/v1/bills`, {
          appointment_id: id,
          patient_id: appointment.patient_id,
          doctor_id: appointment.doctor_id,
          amount: 100.00, // No-show fee
          bill_type: 'NO_SHOW_FEE'
        });
      } catch (error) {
        logger.warn('Failed to generate no-show fee', { error: error.message });
      }

      logger.info('Appointment marked as no-show', {
        correlationId: req.correlationId,
        appointmentId: id
      });

      res.json({
        success: true,
        data: updateResult.rows[0],
        correlationId: req.correlationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }

  async getAppointment(req, res, next) {
    try {
      const { id } = req.params;

      const result = await pool.query(
        'SELECT * FROM appointments WHERE appointment_id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
      }

      res.json({
        success: true,
        data: result.rows[0],
        correlationId: req.correlationId
      });
    } catch (error) {
      next(error);
    }
  }

  async getAppointments(req, res, next) {
    try {
      const { patient_id, doctor_id, status, date, page = 1, limit = 10 } = req.query;

      const conditions = [];
      const values = [];
      let paramCount = 0;

      if (patient_id) {
        paramCount++;
        conditions.push(`patient_id = $${paramCount}`);
        values.push(patient_id);
      }

      if (doctor_id) {
        paramCount++;
        conditions.push(`doctor_id = $${paramCount}`);
        values.push(doctor_id);
      }

      if (status) {
        paramCount++;
        conditions.push(`status = $${paramCount}`);
        values.push(status);
      }

      if (date) {
        paramCount++;
        conditions.push(`appointment_date = $${paramCount}`);
        values.push(date);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const offset = (page - 1) * limit;

      // Get total count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM appointments ${whereClause}`,
        values
      );
      const totalCount = parseInt(countResult.rows[0].count);

      // Get paginated results
      const result = await pool.query(
        `SELECT * FROM appointments ${whereClause}
         ORDER BY appointment_date DESC, start_time DESC
         LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
        [...values, limit, offset]
      );

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / limit)
        },
        correlationId: req.correlationId
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AppointmentController();
