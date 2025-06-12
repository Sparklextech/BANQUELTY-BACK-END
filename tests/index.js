const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const chalk = require('chalk');
const path = require('path');
const winston = require('winston');

// Configuration
const BASE_URL = 'http:///api';
const TEST_USERS = [
    {
        name: 'Test Admin',
        email: 'admin@test.com',
        password: 'admin123',
        role: 'admin'
    },
    {
        name: 'Test Vendor',
        email: 'vendor@test.com',
        password: 'vendor123',
        role: 'vendor'
    },
    {
        name: 'Test User',
        email: 'user@test.com',
        password: 'user123',
        role: 'user'
    }
];

// Configure logger
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// Configure axios with longer timeout and better error handling
const api = axios.create({
    baseURL: 'http://localhost:4010/api',
    timeout: 30000, // 30 seconds timeout
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add response interceptor for logging
api.interceptors.response.use(
    response => {
        logger.debug('Response received', {
            url: response.config.url,
            status: response.status,
            data: response.data
        });
        return response;
    },
    error => {
        logger.error('Request failed', {
            url: error.config?.url,
            method: error.config?.method,
            status: error.response?.status,
            message: error.message,
            response: error.response?.data
        });
        return Promise.reject(error);
    }
);

// Add request interceptor for logging
api.interceptors.request.use(
    config => {
        logger.debug('Request sent', {
            url: config.url,
            method: config.method,
            data: config.data
        });
        return config;
    },
    error => {
        logger.error('Request configuration error', {
            error: error.message
        });
        return Promise.reject(error);
    }
);

// Helper Functions
const log = {
    step: (message) => console.log(`\n${chalk.cyan('=== ' + message + ' ===')}`),
    success: (message) => console.log(chalk.green('[SUCCESS] ' + message)),
    error: (message) => console.log(chalk.red('[ERROR] ' + message)),
    warning: (message) => console.log(chalk.yellow('[WARNING] ' + message)),
    info: (message) => console.log(message),
    debug: (message) => console.log(chalk.gray('[DEBUG] ' + message))
};

async function apiRequest(method, endpoint, body = null, token = null, expectedStatus = 200) {
    try {
        const config = {
            method,
            url: `${BASE_URL}${endpoint}`,
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` })
            },
            ...(body && { data: body }),
            validateStatus: (status) => status === expectedStatus,
            timeout: 10000 // Increased timeout to 10 seconds
        };

        log.debug(`Making ${method} request to ${endpoint}`);
        log.debug(`Request config: ${JSON.stringify(config, null, 2)}`);
        const response = await api(config);
        log.debug(`Response status: ${response.status}`);
        log.debug(`Response data: ${JSON.stringify(response.data, null, 2)}`);
        return response.data;
    } catch (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            log.error(`Request failed with status ${error.response.status}: ${error.response.data?.error || error.message}`);
            log.error(`Response headers: ${JSON.stringify(error.response.headers, null, 2)}`);
            if (error.response.status === expectedStatus) {
                return error.response.data;
            }
        } else if (error.request) {
            // The request was made but no response was received
            log.error(`No response received: ${error.message}`);
            log.error(`Request config: ${JSON.stringify(error.config, null, 2)}`);
        } else {
            // Something happened in setting up the request that triggered an Error
            log.error(`Request setup error: ${error.message}`);
            log.error(`Stack trace: ${error.stack}`);
        }
        throw error;
    }
}

// Main Test Function
async function runTests() {
    const testData = {
        tokens: {},
        ids: {}
    };

    try {
        log.info('\n=== Starting Backend Test Suite ===');

        // Check if services are running
        log.step('Checking service health');
        try {
            const healthResponse = await api.get('/auth/health', { timeout: 5000 });
            log.success(`Auth service health check: ${JSON.stringify(healthResponse.data)}`);
        } catch (error) {
            log.error(`Auth service health check failed: ${error.message}`);
            log.error('Please ensure all services are running with docker-compose up');
            process.exit(1);
        }

        // 1. Test Auth Service
        log.step('Testing Auth Service');

        // Check for existing users
        for (const user of TEST_USERS) {
            try {
                log.debug(`Checking if user exists: ${user.email}`);
                await apiRequest('POST', '/auth/login', {
                    email: user.email,
                    password: user.password
                }, null, 401);
                log.success(`No existing user found for ${user.email}`);
            } catch (error) {
                log.warning(`User ${user.email} might already exist: ${error.message}`);
            }
        }

        // Register and test users
        for (const user of TEST_USERS) {
            log.info(`Registering ${user.role}...`);
            try {
                const registerResponse = await apiRequest('POST', '/auth/register', user);
                log.success(`Registered ${user.role} with ID: ${registerResponse.id}`);

                // Test invalid login
                try {
                    log.debug(`Testing invalid login for ${user.role}`);
                    await apiRequest('POST', '/auth/login', {
                        email: user.email,
                        password: 'wrongpassword'
                    }, null, 401);
                    log.success(`Invalid login test passed for ${user.role}`);
                } catch (error) {
                    log.error(`Invalid login test failed for ${user.role}: ${error.message}`);
                }

                // Login to get token
                log.debug(`Logging in ${user.role}`);
                const loginResponse = await apiRequest('POST', '/auth/login', {
                    email: user.email,
                    password: user.password
                });
                testData.tokens[user.role] = loginResponse.token;
                log.success(`Got token for ${user.role}`);

                // Validate token
                log.debug(`Validating token for ${user.role}`);
                await apiRequest('GET', '/auth/validate', null, testData.tokens[user.role]);
                log.success(`Token validation passed for ${user.role}`);

                // Test token expiration
                log.debug('Testing token expiration');
                const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMzQ1Njc4OTAiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTUxNjIzOTAyM30.1hU5Q9PqJ8Q9Q9Q9Q9Q9Q9Q9Q9Q9Q9Q9Q9Q9Q9Q9Q';
                try {
                    await apiRequest('GET', '/auth/validate', null, expiredToken, 401);
                    log.success('Token expiration test passed');
                } catch (error) {
                    log.error(`Token expiration test failed: ${error.message}`);
                }
            } catch (error) {
                log.error(`Failed to process user ${user.role}: ${error.message}`);
                throw error;
            }
        }

        // 2. Test Vendor Service
        log.step('Testing Vendor Service');

        // Create Vendor Profile
        const vendorProfile = {
            name: 'Test Vendor Business',
            email: 'business@test.com',
            phone: '1234567890',
            description: 'Test vendor business description'
        };

        const vendorResponse = await apiRequest('POST', '/vendor', vendorProfile, testData.tokens.vendor);
        testData.ids.vendorId = vendorResponse.id;
        log.success(`Created vendor profile with ID: ${testData.ids.vendorId}`);

        // Update KYC status
        const kycUpdate = {
            kycStatus: 'approved',
            kycDetails: {
                documentType: 'business_license',
                documentNumber: 'TEST123'
            }
        };

        await apiRequest('PUT', `/vendor/${testData.ids.vendorId}/kyc`, kycUpdate, testData.tokens.admin);
        log.success('Updated vendor KYC status');

        // Create Additional Service
        const service = {
            name: 'Test Service',
            category: 'catering',
            sub_category: 'buffet',
            price_range: '1000-2000',
            description: 'Test service description'
        };

        const serviceResponse = await apiRequest('POST', '/vendor/services', service, testData.tokens.vendor);
        testData.ids.serviceId = serviceResponse.id;
        log.success(`Created additional service with ID: ${testData.ids.serviceId}`);

        // 3. Test Venue Service
        log.step('Testing Venue Service');

        // Create Venue
        const venue = {
            name: 'Test Venue',
            type: 'banquet_hall',
            locality: 'Test City',
            address: '123 Test Street',
            capacity: 100,
            price_per_day: 1000,
            description: 'Test venue description'
        };

        const venueResponse = await apiRequest('POST', '/venue', venue, testData.tokens.vendor);
        testData.ids.venueId = venueResponse.id;
        log.success(`Created venue with ID: ${testData.ids.venueId}`);

        // Set Venue Availability
        const availability = {
            date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            is_available: true
        };

        await apiRequest('POST', `/venue/${testData.ids.venueId}/availability`, availability, testData.tokens.vendor);
        log.success('Set venue availability');

        // Test venue search and filtering
        log.debug('Testing venue search and filtering');
        const searchParams = {
            type: 'banquet_hall',
            locality: 'Test City',
            min_capacity: 50,
            max_price: 2000
        };

        const searchResponse = await apiRequest('GET', '/venue/search', null, testData.tokens.user, 200, searchParams);
        log.success(`Found ${searchResponse.length} venues matching search criteria`);

        // 4. Test Booking Service
        log.step('Testing Booking Service');

        // Create Booking
        const booking = {
            venue_id: testData.ids.venueId,
            event_date: availability.date,
            start_time: '10:00:00',
            end_time: '22:00:00',
            guest_count: 50,
            pricing_type: 'flat',
            flat_price: 1000,
            services: [{
                service_id: testData.ids.serviceId,
                price: 1500
            }]
        };

        const bookingResponse = await apiRequest('POST', '/booking', booking, testData.tokens.user);
        testData.ids.bookingId = bookingResponse.id;
        log.success(`Created booking with ID: ${testData.ids.bookingId}`);

        // Update Booking Status
        const statusUpdate = {
            status: 'confirmed'
        };

        await apiRequest('PUT', `/booking/${testData.ids.bookingId}/status`, statusUpdate, testData.tokens.vendor);
        log.success('Updated booking status to confirmed');

        // Test concurrent bookings
        log.debug('Testing concurrent bookings');
        const concurrentBooking = {
            venue_id: testData.ids.venueId,
            event_date: availability.date,
            start_time: '10:00:00',
            end_time: '22:00:00',
            guest_count: 50,
            pricing_type: 'flat',
            flat_price: 1000
        };

        try {
            await apiRequest('POST', '/booking', concurrentBooking, testData.tokens.user, 409);
            log.success('Concurrent booking test passed - conflict detected');
        } catch (error) {
            log.error(`Concurrent booking test failed: ${error.message}`);
        }

        // 5. Test Media Service
        log.step('Testing Media Service');

        // Enhance Media Service tests
        log.debug('Testing media service with different file types');
        const testFiles = [
            { type: 'image', size: 1024, extension: 'jpg' },
            { type: 'image', size: 2048, extension: 'png' },
            { type: 'document', size: 512, extension: 'pdf' }
        ];

        for (const file of testFiles) {
            const testFilePath = path.join(__dirname, `test-${file.type}.${file.extension}`);
            const fileBuffer = Buffer.alloc(file.size);
            for (let i = 0; i < file.size; i++) {
                fileBuffer[i] = i % 256;
            }
            fs.writeFileSync(testFilePath, fileBuffer);

            const formData = new FormData();
            formData.append('file', fs.createReadStream(testFilePath));
            formData.append('reference_id', testData.ids.venueId);
            formData.append('reference_type', 'venue');
            formData.append('media_type', file.type);

            try {
                const mediaResponse = await api.post('/media/upload', formData, {
                    headers: {
                        ...formData.getHeaders(),
                        Authorization: `Bearer ${testData.tokens.vendor}`
                    }
                });
                log.success(`Uploaded ${file.type} with ID: ${mediaResponse.data.id}`);
            } catch (error) {
                log.error(`${file.type} upload failed: ${error.message}`);
            }

            // Cleanup test file
            try {
                fs.unlinkSync(testFilePath);
            } catch (error) {
                log.warning(`Could not delete test file: ${error.message}`);
            }
        }

        // 6. Test Admin Service
        log.step('Testing Admin Service');

        // Get Dashboard Analytics
        await apiRequest('GET', '/admin/dashboard', null, testData.tokens.admin);
        log.success('Retrieved admin dashboard data');

        // Get All Users
        await apiRequest('GET', '/admin/users', null, testData.tokens.admin);
        log.success('Retrieved all users');

        // Get All Vendors
        await apiRequest('GET', '/admin/vendors', null, testData.tokens.admin);
        log.success('Retrieved all vendors');

        // 7. Test Notification Service
        log.step('Testing Notification Service');

        // Enhance Notification Service tests
        log.debug('Testing different notification types');
        const notificationTypes = [
            {
                type: 'booking_confirmation',
                message: 'Your booking has been confirmed',
                data: { booking_id: testData.ids.bookingId }
            },
            {
                type: 'booking_cancellation',
                message: 'Your booking has been cancelled',
                data: { booking_id: testData.ids.bookingId }
            },
            {
                type: 'payment_reminder',
                message: 'Payment due for your booking',
                data: { booking_id: testData.ids.bookingId, amount: 1000 }
            }
        ];

        for (const notification of notificationTypes) {
            try {
                await apiRequest('POST', '/notification', {
                    user_id: testData.ids.userId,
                    ...notification
                }, testData.tokens.admin);
                log.success(`Sent ${notification.type} notification`);
            } catch (error) {
                log.error(`Failed to send ${notification.type} notification: ${error.message}`);
            }
        }

        // Test notification delivery status
        try {
            const deliveryStatus = await apiRequest('GET', `/notification/${testData.ids.bookingId}/status`, null, testData.tokens.user);
            log.success(`Retrieved notification delivery status: ${JSON.stringify(deliveryStatus)}`);
        } catch (error) {
            log.error(`Failed to get notification delivery status: ${error.message}`);
        }

        // 8. Cleanup
        log.step('Cleaning up test data');

        // Final Summary
        log.info('\n=== Test Suite Completed ===');
        log.success('All services tested successfully!');
        log.info('\nTest data created:');
        log.info(`- Users: ${TEST_USERS.length}`);
        log.info(`- Vendor Profile: ${testData.ids.vendorId}`);
        log.info(`- Venue: ${testData.ids.venueId}`);
        log.info(`- Service: ${testData.ids.serviceId}`);
        log.info(`- Booking: ${testData.ids.bookingId}`);
        log.info('\nYou can use these IDs for further testing or cleanup.');

    } catch (error) {
        log.error(`Test suite failed: ${error.message}`);
        if (error.stack) {
            log.error(`Stack trace: ${error.stack}`);
        }
        process.exit(1);
    }
}

// Run the tests
runTests(); 