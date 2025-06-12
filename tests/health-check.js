/**
 * health-check.js - Tests all microservices health endpoints
 * Ensures all services are operational before deployment
 */
const axios = require('axios');
const colors = require('colors/safe');

// Configuration
const GATEWAY_PORT = process.env.GATEWAY_PORT || 4010;
const SERVICES = [
  { name: 'Gateway', url: `http://localhost:${GATEWAY_PORT}/api/health`, expectStatus: 200 },
  { name: 'Auth Service', url: `http://localhost:${GATEWAY_PORT}/api/auth/health`, expectStatus: 200 },
  { name: 'Venue Service', url: `http://localhost:${GATEWAY_PORT}/api/venue/health`, expectStatus: 200 },
  { name: 'Vendor Service', url: `http://localhost:${GATEWAY_PORT}/api/vendor/health`, expectStatus: 200 },
  { name: 'Booking Service', url: `http://localhost:${GATEWAY_PORT}/api/booking/health`, expectStatus: 200 },
  { name: 'Notification Service', url: `http://localhost:${GATEWAY_PORT}/api/notification/health`, expectStatus: 200 },
  { name: 'Media Service', url: `http://localhost:${GATEWAY_PORT}/api/media/health`, expectStatus: 200 },
  { name: 'Admin Service', url: `http://localhost:${GATEWAY_PORT}/api/admin/health`, expectStatus: 200 },
];

// Health check function
async function checkHealth(service) {
  console.log(colors.cyan(`Checking ${service.name}...`));
  try {
    const startTime = Date.now();
    const response = await axios.get(service.url, { 
      validateStatus: false,
      timeout: 5000
    });
    const responseTime = Date.now() - startTime;
    
    if (response.status === service.expectStatus) {
      console.log(colors.green(`✓ ${service.name} is healthy (${response.status}, ${responseTime}ms)`));
      return { success: true, service: service.name, responseTime };
    } else {
      console.log(colors.red(`✗ ${service.name} returned unexpected status: ${response.status} (expected ${service.expectStatus})`));
      return { 
        success: false, 
        service: service.name, 
        error: `Unexpected status: ${response.status}`,
        responseTime
      };
    }
  } catch (error) {
    console.log(colors.red(`✗ ${service.name} is unhealthy: ${error.message}`));
    return { 
      success: false, 
      service: service.name, 
      error: error.message 
    };
  }
}

// Run all health checks
async function runHealthChecks() {
  console.log(colors.yellow('========================================='));
  console.log(colors.yellow('  BANQUET APP BACKEND HEALTH CHECKER'));
  console.log(colors.yellow('========================================='));
  console.log(colors.cyan(`Testing ${SERVICES.length} services via gateway on port ${GATEWAY_PORT}`));
  
  const results = [];
  let allHealthy = true;
  
  for (const service of SERVICES) {
    const result = await checkHealth(service);
    results.push(result);
    if (!result.success) allHealthy = false;
  }
  
  // Print summary
  console.log(colors.yellow('\n-----------------------------------------'));
  console.log(colors.yellow('  HEALTH CHECK SUMMARY'));
  console.log(colors.yellow('-----------------------------------------'));
  
  const healthy = results.filter(r => r.success).length;
  const unhealthy = results.filter(r => !r.success).length;
  
  console.log(colors.cyan(`Total Services: ${results.length}`));
  console.log(colors.green(`Healthy: ${healthy}`));
  console.log(colors.red(`Unhealthy: ${unhealthy}`));
  
  if (allHealthy) {
    console.log(colors.green('\n✓ All services are healthy and ready for deployment!'));
    process.exit(0);
  } else {
    console.log(colors.red('\n✗ Some services are unhealthy. Fix issues before deployment.'));
    
    // List unhealthy services
    console.log(colors.yellow('\nUnhealthy Services:'));
    results.filter(r => !r.success).forEach(r => {
      console.log(colors.red(`- ${r.service}: ${r.error}`));
    });
    
    process.exit(1);
  }
}

// Run the health checks
runHealthChecks().catch(error => {
  console.error(colors.red('Error running health checks:'), error);
  process.exit(1);
});
