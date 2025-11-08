const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const { validate } = require('../middleware/validator');

/**
 * @swagger
 * /v1/appointments:
 *   post:
 *     summary: Book a new appointment
 *     tags: [Appointments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - patient_id
 *               - doctor_id
 *               - appointment_date
 *               - start_time
 *               - end_time
 *             properties:
 *               patient_id:
 *                 type: integer
 *               doctor_id:
 *                 type: integer
 *               appointment_date:
 *                 type: string
 *                 format: date
 *               start_time:
 *                 type: string
 *                 example: '10:00'
 *               end_time:
 *                 type: string
 *                 example: '10:30'
 *               reason:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Appointment booked successfully
 *       404:
 *         description: Patient or Doctor not found
 *       409:
 *         description: Time slot conflict
 */
router.post('/', validate('bookAppointment'), appointmentController.bookAppointment.bind(appointmentController));

/**
 * @swagger
 * /v1/appointments:
 *   get:
 *     summary: Get appointments with filters
 *     tags: [Appointments]
 *     parameters:
 *       - in: query
 *         name: patient_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: doctor_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [SCHEDULED, COMPLETED, CANCELLED, NO_SHOW]
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of appointments
 */
router.get('/', validate('searchQuery'), appointmentController.getAppointments.bind(appointmentController));

/**
 * @swagger
 * /v1/appointments/{id}:
 *   get:
 *     summary: Get appointment by ID
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Appointment details
 *       404:
 *         description: Appointment not found
 */
router.get('/:id', appointmentController.getAppointment.bind(appointmentController));

/**
 * @swagger
 * /v1/appointments/{id}/reschedule:
 *   put:
 *     summary: Reschedule appointment (max 2 times, 1h cutoff)
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - appointment_date
 *               - start_time
 *               - end_time
 *             properties:
 *               appointment_date:
 *                 type: string
 *                 format: date
 *               start_time:
 *                 type: string
 *               end_time:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Appointment rescheduled
 *       400:
 *         description: Max reschedule limit or cutoff exceeded
 */
router.put('/:id/reschedule', validate('rescheduleAppointment'), appointmentController.rescheduleAppointment.bind(appointmentController));

/**
 * @swagger
 * /v1/appointments/{id}/cancel:
 *   put:
 *     summary: Cancel appointment with refund policy
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Appointment cancelled
 */
router.put('/:id/cancel', validate('cancelAppointment'), appointmentController.cancelAppointment.bind(appointmentController));

/**
 * @swagger
 * /v1/appointments/{id}/complete:
 *   put:
 *     summary: Mark appointment as completed
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Appointment completed
 */
router.put('/:id/complete', validate('completeAppointment'), appointmentController.completeAppointment.bind(appointmentController));

/**
 * @swagger
 * /v1/appointments/{id}/no-show:
 *   put:
 *     summary: Mark appointment as no-show
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Appointment marked as no-show
 */
router.put('/:id/no-show', appointmentController.markNoShow.bind(appointmentController));

module.exports = router;
