# Appointment Service

The Appointment Service is the core orchestration microservice for managing appointments in the Hospital Management System. It handles booking, rescheduling, cancellation, completion, and no-show tracking with complex business logic and inter-service communication.

## Features

- **Book Appointments**: Validate patient/doctor availability and prevent slot conflicts
- **Reschedule Logic**: Maximum 2 reschedules with 1-hour cutoff before appointment
- **Cancel with Refund Policies**:
  - 24+ hours: Full refund
  - 6-24 hours: Partial refund
  - <6 hours: Cancellation fee
- **Complete Appointments**: Triggers billing workflow
- **No-Show Handling**: Applies no-show fees
- **Inter-Service Communication**: Integrates with Patient, Doctor, Billing, and Notification services
- **Optimistic Locking**: Version control to prevent race conditions
- **Comprehensive Validation**: Using Joi
- **Structured Logging**: With PII masking (Winston)
- **Prometheus Metrics**: For monitoring
- **Health Checks**: /health, /ready, /live
- **Swagger Documentation**: OpenAPI 3.0

## Technology Stack

- **Runtime**: Node.js 18
- **Framework**: Express.js
- **Database**: PostgreSQL
- **HTTP Client**: Axios (for inter-service communication)
- **Validation**: Joi
- **Logging**: Winston
- **Metrics**: Prometheus (prom-client)
- **Documentation**: Swagger/OpenAPI 3.0
- **Security**: Helmet, CORS, express-rate-limit

## Prerequisites

- Node.js 18 or higher
- PostgreSQL 13 or higher
- Running instances of Patient Service (3001), Doctor Service (3002), Billing Service (3004), Notification Service (3007)

## Installation

1. Navigate to the service directory:
```bash
cd hms-appointment-service
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration

5. Start the service:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Database Schema

```sql
CREATE TABLE appointments (
  appointment_id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) DEFAULT 'SCHEDULED',
  reason TEXT,
  notes TEXT,
  reschedule_count INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, appointment_date, start_time)
);
```

**Status Values**: SCHEDULED, COMPLETED, CANCELLED, NO_SHOW

## API Endpoints

### Health Checks

- `GET /health` - Service health with database connectivity
- `GET /ready` - Readiness probe
- `GET /live` - Liveness probe

### Metrics

- `GET /metrics` - Prometheus metrics

### Appointment Management

#### Book Appointment
```http
POST /v1/appointments
Content-Type: application/json

{
  "patient_id": 1,
  "doctor_id": 2,
  "appointment_date": "2024-12-25",
  "start_time": "10:00",
  "end_time": "10:30",
  "reason": "Regular checkup",
  "notes": "Patient has history of hypertension"
}
```

Response: `201 Created`
```json
{
  "success": true,
  "data": {
    "appointment_id": 1,
    "patient_id": 1,
    "doctor_id": 2,
    "appointment_date": "2024-12-25",
    "start_time": "10:00:00",
    "end_time": "10:30:00",
    "status": "SCHEDULED",
    "reschedule_count": 0,
    "version": 1,
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "correlationId": "uuid"
}
```

**Validations**:
- Patient must exist (validated via Patient Service)
- Doctor must exist (validated via Doctor Service)
- Appointment must be in the future
- No slot conflicts for the doctor
- Triggers notification to patient

#### Get Appointments (with filters)
```http
GET /v1/appointments?patient_id=1&status=SCHEDULED&page=1&limit=10
```

Query parameters:
- `patient_id`: Filter by patient
- `doctor_id`: Filter by doctor
- `status`: Filter by status (SCHEDULED, COMPLETED, CANCELLED, NO_SHOW)
- `date`: Filter by specific date
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 10)

#### Get Appointment by ID
```http
GET /v1/appointments/1
```

#### Reschedule Appointment
```http
PUT /v1/appointments/1/reschedule
Content-Type: application/json

{
  "appointment_date": "2024-12-26",
  "start_time": "11:00",
  "end_time": "11:30",
  "reason": "Personal conflict"
}
```

**Business Rules**:
- Maximum 2 reschedules per appointment
- Cannot reschedule within 1 hour of appointment time
- New time must be in the future
- New slot must be available (no conflicts)
- Increments `reschedule_count` and `version`

#### Cancel Appointment
```http
PUT /v1/appointments/1/cancel
Content-Type: application/json

{
  "reason": "Feeling better"
}
```

**Refund Policies**:
- Cancelled 24+ hours before: `FULL_REFUND`
- Cancelled 6-24 hours before: `PARTIAL_REFUND`
- Cancelled <6 hours before: `CANCELLATION_FEE`
- Notifies Billing Service for refund processing

#### Complete Appointment
```http
PUT /v1/appointments/1/complete
Content-Type: application/json

{
  "notes": "Patient examined, prescribed medication"
}
```

**Actions**:
- Updates status to COMPLETED
- Triggers bill generation via Billing Service
- Base consultation fee: $500

#### Mark No-Show
```http
PUT /v1/appointments/1/no-show
```

**Actions**:
- Updates status to NO_SHOW
- Applies no-show fee ($100) via Billing Service

## Inter-Service Communication

The Appointment Service orchestrates workflows across multiple services:

### Patient Service (3001)
- **Validates** patient existence before booking

### Doctor Service (3002)
- **Validates** doctor existence before booking

### Billing Service (3004)
- **Generates bills** when appointment is completed
- **Processes cancellations** with refund policies
- **Applies no-show fees**

### Notification Service (3007)
- **Sends confirmation** when appointment is booked
- **Sends reminders** for upcoming appointments
- **Sends cancellation** notifications
- **Notifies** about rescheduling

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "APPOINTMENT_NOT_FOUND",
    "message": "Appointment not found",
    "correlationId": "uuid",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

Common error codes:
- `APPOINTMENT_NOT_FOUND` (404)
- `PATIENT_NOT_FOUND` (404)
- `DOCTOR_NOT_FOUND` (404)
- `SLOT_CONFLICT` (409)
- `MAX_RESCHEDULE_EXCEEDED` (400)
- `CUTOFF_TIME_EXCEEDED` (400)
- `INVALID_STATUS` (400)
- `INVALID_DATE` (400)
- `SERVICE_UNAVAILABLE` (503)
- `VALIDATION_ERROR` (400)

## Logging

Winston structured JSON logging with PII masking:
- Email: `j***n@hospital.com`
- Phone: `******3210`
- Passwords/tokens: `***REDACTED***`

Logs written to:
- Console (with colors)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)

Each log includes `correlationId` for tracing across services.

## Metrics

Prometheus metrics at `/metrics`:

- `http_request_duration_ms` - Request duration histogram
- `http_requests_total` - Total HTTP requests
- `appointments_created_total` - Total appointments booked
- `appointments_cancelled_total` - Total cancellations
- `appointments_rescheduled_total` - Total reschedules
- Default Node.js metrics

## Security

- **Helmet**: Security headers
- **CORS**: Configurable origins
- **Rate Limiting**: 100 requests/15min per IP
- **Input Validation**: Joi schemas
- **PII Masking**: Sensitive data masked in logs

## Docker

Build:
```bash
docker build -t hms-appointment-service .
```

Run:
```bash
docker run -p 3003:3003 \
  -e DB_HOST=host.docker.internal \
  -e DB_NAME=hms_appointments \
  -e PATIENT_SERVICE_URL=http://host.docker.internal:3001 \
  -e DOCTOR_SERVICE_URL=http://host.docker.internal:3002 \
  -e BILLING_SERVICE_URL=http://host.docker.internal:3004 \
  -e NOTIFICATION_SERVICE_URL=http://host.docker.internal:3007 \
  hms-appointment-service
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3003 |
| DB_HOST | PostgreSQL host | localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_NAME | Database name | hms_appointments |
| DB_USER | Database user | postgres |
| DB_PASSWORD | Database password | postgres |
| PATIENT_SERVICE_URL | Patient service URL | http://localhost:3001 |
| DOCTOR_SERVICE_URL | Doctor service URL | http://localhost:3002 |
| BILLING_SERVICE_URL | Billing service URL | http://localhost:3004 |
| NOTIFICATION_SERVICE_URL | Notification service URL | http://localhost:3007 |
| LOG_LEVEL | Logging level | info |
| CORS_ORIGIN | CORS origins | * |
| RATE_LIMIT_WINDOW_MS | Rate limit window | 900000 |
| RATE_LIMIT_MAX_REQUESTS | Max requests | 100 |

## Architecture

```
src/
├── index.js                          # Entry point
├── config/
│   ├── database.js                   # Database & schema
│   └── swagger.js                    # API documentation
├── controllers/
│   └── appointment.controller.js     # Business logic & orchestration
├── routes/
│   ├── appointment.routes.js         # API routes
│   └── health.routes.js              # Health checks
├── middleware/
│   ├── errorHandler.js               # Error handling
│   ├── requestLogger.js              # Request logging
│   └── validator.js                  # Joi validation
├── utils/
│   ├── logger.js                     # Winston logger
│   ├── metrics.js                    # Prometheus metrics
│   └── piiMasker.js                  # PII masking
└── scripts/
    └── loadSeedData.js               # Seed data loader
```

## Development

Run tests:
```bash
npm test
```

API Documentation:
```
http://localhost:3003/api-docs
```

## License

MIT
