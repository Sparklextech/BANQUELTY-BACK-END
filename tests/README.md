# Banquet App Microservices Tests

This directory contains comprehensive tests for the Banquet App microservices architecture.

## Prerequisites

- Node.js (v14 or higher)
- Docker and Docker Compose
- All microservices running (use `docker-compose up` in the root directory)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Ensure all services are running:
```bash
cd ..
docker-compose up -d
```

3. Wait for all services to be fully operational (check with `docker-compose ps`)

## Running Tests

To run all tests:
```bash
npm test
```

## Test Structure

The test suite includes tests for:

- Authentication Service
  - User registration
  - User login
  - Token validation

- Vendor Service
  - Vendor profile creation
  - Service creation
  - Profile updates

- Venue Service
  - Venue creation
  - Category management
  - Search and filtering

- Media Service
  - Image upload
  - File type validation
  - Size limits

- Booking Service
  - Booking creation
  - Status updates
  - Conflict detection

- Admin Service
  - User management
  - Vendor approval
  - System settings

- Notification Service
  - Email notifications
  - Push notifications
  - Delivery status

## Test Data

The tests create and manage test data including:
- Test users (admin, vendor, regular user)
- Vendor profiles
- Services
- Venues
- Bookings
- Media files

All test data is automatically cleaned up after the tests complete.

## Troubleshooting

If tests fail:
1. Check that all services are running (`docker-compose ps`)
2. Verify service logs (`docker-compose logs [service-name]`)
3. Ensure the API Gateway is accessible at http://localhost:4010
4. Check that the test image file exists in the root directory 