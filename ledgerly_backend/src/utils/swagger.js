const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ledgerly API',
      version: '1.0.0',
      description: 'School fees and financial management SaaS API',
    },
    servers: [
      { url: 'https://ledgerly-677r.onrender.com/api/v1', description: 'Production' },
      { url: 'http://localhost:4000/api/v1', description: 'Local dev' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'], // JSDoc annotations in route files
};

const specs = swaggerJsdoc(options);

module.exports = { specs, swaggerUi };
