# Banquet App Backend – Microservices Architecture

A production-ready, dockerized backend for a banquet/event booking application. Built with Node.js, Express, Sequelize, PostgreSQL, and Docker Compose. Features robust authentication, vendor and venue management, booking, media uploads, notifications, and a secure API Gateway.

---

## 🚀 Features
- User authentication with JWT
- Vendor, venue, and booking management
- Media uploads (local storage)
- Notification service
- Centralized API Gateway with JWT validation, logging, and rate limiting
- Robust error handling and logging (Winston)
- PostgreSQL database (single instance, multiple schemas)
- Fully dockerized with Docker Compose

## 👥 User Roles & Capabilities

### Regular Users
- Register and login with email and password
- View and manage their profile
- Browse and search venues
- View venue details (name, address, capacity)
- View vendor profiles and services
- Book venues for events
- View booking history
- Upload media (photos/videos) for events
- Receive booking notifications
- View venue availability
- View vendor services and packages
- Make payments for bookings
- Cancel bookings (subject to terms)

### Vendors
- Register and login with email and password
- Complete KYC verification
- Create and manage vendor profile
- Add and manage venues:
  - Set venue name, address, capacity
  - Upload venue photos
  - Set pricing (flat rate or per head)
  - Set availability calendar
- Create and manage additional services:
  - Add service name and description
  - Set service pricing
  - Update service details
- View dashboard with:
  - Total venues count
  - Total services count
  - Booking statistics
- Manage bookings:
  - View all bookings for their venues
  - Update booking status
  - View booking details
- Receive notifications about:
  - New bookings
  - Booking updates
  - Customer messages

### Administrators
- Register and login with username and password
- Access admin dashboard with analytics:
  - Total users count
  - Total vendors count
  - Total bookings count
  - Total revenue
- Manage users:
  - View all users
  - Suspend/activate user accounts
  - View user details
- Manage vendors:
  - View all vendors
  - Approve/reject vendor KYC
  - Suspend/activate vendor accounts
  - View vendor details
- Monitor system health:
  - View service status
  - Check database connections
  - Monitor error logs
- Manage platform settings:
  - Update system configurations
  - Manage notification templates
  - Set platform policies
- View and manage all bookings
- Access comprehensive reports and analytics
- Send system-wide notifications
- Handle customer support tickets
- Manage media content

---

## 🏗️ Microservices Overview
| Service                | Directory                       | Port  | Description                      |
|------------------------|----------------------------------|-------|----------------------------------|
| API Gateway            | gateway/                         | 4010  | Central routing, JWT, logging    |
| Auth Service           | services/auth-service/           | 4007  | User authentication, JWT         |
| Venue Service          | services/venue-service/          | 4002  | Venue CRUD                       |
| Vendor Service         | services/vendor-service/         | 4003  | Vendor CRUD, dashboard           |
| Admin Service          | services/admin-service/          | 4001  | Admin management                 |
| Calendar Service       | services/calendar-service/       | 4004  | Venue availability management    |
| Booking Service        | services/booking-service/        | 4005  | Booking CRUD, pricing logic      |
| Media Service          | services/media-service/          | 4006  | File uploads, static serving     |
| Notification Service   | services/notification-service/   | 4008  | Notifications                    |
| PostgreSQL             | (docker container)               | 5432  | Database                         |

---

## ⚙️ Tech Stack
- **Node.js** (Express)
- **Sequelize** ORM
- **PostgreSQL** (single instance, multi-schema)
- **Docker & Docker Compose**
- **Multer** (media uploads)
- **Winston** (logging)
- **JWT** (authentication)

---

## 📦 Setup & Usage

### Prerequisites
- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd banquet-app-backend-main
```

### 2. Configure Environment Variables
Create a `.env` file in the project root:
```ini
POSTGRES_DB=banquet_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# Service Ports
ADMIN_SERVICE_PORT=4001
VENUE_SERVICE_PORT=4002
VENDOR_SERVICE_PORT=4003
CALENDAR_SERVICE_PORT=4004
BOOKING_SERVICE_PORT=4005
MEDIA_SERVICE_PORT=4006
AUTH_SERVICE_PORT=4007
NOTIFICATION_SERVICE_PORT=4008
GATEWAY_PORT=4010

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_specific_password
SMTP_FROM=your_email@gmail.com

# JWT Secret
JWT_SECRET=your_jwt_secret_here

# Other configs
NODE_ENV=production
```

> You can adjust ports and secrets as needed.

### 3. Build and Start All Services
#### Windows:
```powershell
.\setup.ps1
```
#### Linux/macOS:
```bash
chmod +x setup.sh
./setup.sh
```

- All services will be available on their respective ports (see table above).
- Media uploads will be stored in `./uploads` (mounted to the media service container).

### 4. Accessing the API Gateway
- Main entrypoint: `http://localhost:4010/api/`
- All requests should go through the gateway.
- Authentication is required for all endpoints except `/api/auth/*`

---

## 🔒 Environment Variables
| Variable         | Description                       |
|------------------|-----------------------------------|
| POSTGRES_DB      | PostgreSQL database name          |
| POSTGRES_USER    | PostgreSQL username               |
| POSTGRES_PASSWORD| PostgreSQL password               |
| POSTGRES_HOST    | Hostname for PostgreSQL (default: postgres) |
| POSTGRES_PORT    | PostgreSQL port (default: 5432)   |
| GATEWAY_PORT     | API Gateway exposed port (default: 4010) |
| JWT_SECRET       | Secret for signing JWT tokens      |
| SMTP_*           | Email configuration for notifications |
| NODE_ENV         | Environment (production/development) |

---

## 📚 API Endpoints (via Gateway)
- `/api/auth/*` – User registration, login, JWT
- `/api/venue/*` – Venue CRUD
- `/api/vendor/*` – Vendor CRUD, dashboard
- `/api/admin/*` – Admin management
- `/api/booking/*` – Booking CRUD, pricing
- `/api/media/upload` – File upload (POST, multipart/form-data)
- `/api/media/files/:filename` – Static file serving
- `/api/notification/*` – Notification endpoints

> All endpoints (except `/api/auth/*`) require JWT in the `Authorization` header.

## 🔐 Authentication Endpoints

### Registration
```http
POST /api/auth/register
Content-Type: application/json

{
    "name": "User Name",
    "email": "user@example.com",
    "password": "password123",
    "role": "user" // or "vendor" or "admin"
}
```

Response:
```json
{
    "id": 1,
    "name": "User Name",
    "email": "user@example.com",
    "role": "user"
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
    "email": "user@example.com",
    "password": "password123"
}
```

Response:
```json
{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
        "id": 1,
        "name": "User Name",
        "email": "user@example.com",
        "role": "user",
        "kycStatus": "pending"
    }
}
```

### Using JWT Token
After login, include the JWT token in the Authorization header for all authenticated requests:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Example Usage with Frontend
```javascript
// Registration
const register = async (userData) => {
  const response = await fetch('http://localhost:4001/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(userData)
  });
  return await response.json();
};

// Login
const login = async (credentials) => {
  const response = await fetch('http://localhost:4001/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(credentials)
  });
  return await response.json();
};

// Authenticated Request
const getProfile = async (token) => {
  const response = await fetch('http://localhost:4001/api/user/profile', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### PowerShell Testing Commands
```powershell
# Registration
$body = @{name='User Name'; email='user@example.com'; password='test123'; role='user'} | ConvertTo-Json
Invoke-WebRequest -Uri 'http://localhost:4001/api/auth/register' -Method Post -Body $body -ContentType 'application/json'

# Login
$body = @{email='user@example.com'; password='test123'} | ConvertTo-Json
Invoke-WebRequest -Uri 'http://localhost:4001/api/auth/login' -Method Post -Body $body -ContentType 'application/json'
```

---

## 🗂️ Media Uploads
- Upload files via `POST /api/media/upload` (multipart/form-data, field name: `file`)
- Uploaded files are stored in the `uploads/` directory (mounted as `/usr/src/app/uploads` in the container)

---

## 🐳 Docker Compose
- Brings up all services, PostgreSQL, and the API gateway in a single network.
- Media uploads are persisted via a bind mount (`./uploads`).
- To stop and remove all containers:
  ```bash
  docker-compose down -v
  ```

---

## 🧪 Sample Data (Optional)
To populate the database with sample data for testing:
1. After running the setup script, connect to the `postgres` container:
   ```bash
   docker exec -it banquet-app-backend-main-postgres-1 psql -U postgres -d banquet_db
   ```
2. Run SQL insert statements or use Sequelize seeders/scripts (add to `services/*/seeders/` if needed).
3. You may also POST to service endpoints using Postman or curl to create users, vendors, venues, etc.

---

## 📝 Logging
- All services use Winston for structured JSON logs (to console by default).
- Logs are visible via `docker-compose logs <service-name>`

---

## 📖 Additional Notes
- Each service uses its own schema/tables but shares the same PostgreSQL instance.
- All inter-service communication is via HTTP (proxied by the gateway).
- No external cloud dependencies (S3, Redis, etc.) – fully local and dockerized.
- The setup scripts (setup.ps1 and setup.sh) handle the complete setup process and verify service health.

---

## 🤝 Contributing
Pull requests and suggestions welcome!

---

## 2025 Banquet App Backend

## 📖 API Documentation

### Authentication Service (`/api/auth/*`)
#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "string",
  "email": "string",
  "password": "string",
  "role": "user|vendor|admin"
}
```
Response:
```json
{
  "id": "number",
  "name": "string",
  "email": "string",
  "role": "string"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "string",
  "password": "string"
}
```
Response:
```json
{
  "token": "string",
  "user": {
    "id": "number",
    "name": "string",
    "email": "string",
    "role": "string",
    "kycStatus": "pending|approved|rejected"
  }
}
```

#### Validate Token
```http
GET /api/auth/validate
Authorization: Bearer <token>
```
Response:
```json
{
  "valid": true,
  "decoded": {
    "id": "number",
    "role": "string",
    "kycStatus": "string"
  }
}
```

### Venue Service (`/api/venue/*`)
#### Create Venue
```http
POST /api/venue
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "string",
  "type": "banquet_hall|marriage_garden|resort|party_hall|destination_venue|kalyana_mandapam|hotel",
  "locality": "string",
  "address": "string",
  "capacity": "number",
  "price_per_day": "number",
  "description": "string"
}
```

#### Get Venues
```http
GET /api/venue
Authorization: Bearer <token>
```

#### Get Venue by ID
```http
GET /api/venue/:id
Authorization: Bearer <token>
```

### Vendor Service (`/api/vendor/*`)
#### Create Service
```http
POST /api/vendor/service
Authorization: Bearer <token>
Content-Type: application/json

{
  "category": "string",
  "sub_category": "string",
  "name": "string",
  "description": "string",
  "price_range": "string"
}
```

#### Get Vendor Services
```http
GET /api/vendor/services
Authorization: Bearer <token>
```

### Booking Service (`/api/booking/*`)
#### Create Booking
```http
POST /api/booking
Authorization: Bearer <token>
Content-Type: application/json

{
  "venue_id": "number",
  "event_date": "YYYY-MM-DD",
  "start_time": "HH:MM:SS",
  "end_time": "HH:MM:SS",
  "services": [
    {
      "service_id": "number",
      "price": "number"
    }
  ]
}
```

#### Get Bookings
```http
GET /api/booking
Authorization: Bearer <token>
```

### Media Service (`/api/media/*`)
#### Upload File
```http
POST /api/media/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <file>
reference_id: "number"
reference_type: "venue|service|user"
media_type: "image|video"
```

#### Get Media
```http
GET /api/media/files/:filename
Authorization: Bearer <token>
```

### Notification Service (`/api/notification/*`)
#### Send Notification
```http
POST /api/notification
Authorization: Bearer <token>
Content-Type: application/json

{
  "user_id": "number",
  "type": "string",
  "message": "string",
  "data": "object"
}
```

### Admin Service (`/api/admin/*`)
#### Get Users
```http
GET /api/admin/users
Authorization: Bearer <token>
```

#### Update User Status
```http
PUT /api/admin/users/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "active|inactive|pending"
}
```

### Error Responses
All endpoints may return the following error responses:

```json
{
  "error": "string"
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

### Authentication
- All endpoints except `/api/auth/*` require a valid JWT token
- Include token in the Authorization header: `Authorization: Bearer <token>`
- Tokens expire after 24 hours

### Data Models

#### User
```typescript
interface User {
  id: number;
  name: string;
  email: string;
  role: 'user' | 'vendor' | 'admin';
  status: 'active' | 'inactive' | 'pending';
  created_at: Date;
}
```

#### Venue
```typescript
interface Venue {
  id: number;
  vendor_id: number;
  name: string;
  type: 'banquet_hall' | 'marriage_garden' | 'resort' | 'party_hall' | 'destination_venue' | 'kalyana_mandapam' | 'hotel';
  locality: string;
  address: string;
  capacity: number;
  price_per_day: number;
  description: string;
  status: 'active' | 'inactive' | 'pending';
  created_at: Date;
}
```

#### Service
```typescript
interface Service {
  id: number;
  vendor_id: number;
  category: string;
  sub_category: string;
  name: string;
  description: string;
  price_range: string;
  status: 'active' | 'inactive' | 'pending';
  created_at: Date;
}
```

#### Booking
```typescript
interface Booking {
  id: number;
  user_id: number;
  venue_id: number;
  event_date: Date;
  start_time: string;
  end_time: string;
  total_amount: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  created_at: Date;
}
```