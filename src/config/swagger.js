/**
 * @file swagger.js
 * @description Configuración centralizada de OpenAPI 3.0 / Swagger UI.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const opciones = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ScrumFlow API Documentation',
      version: '1.0.0',
      description: 'Documentación oficial de los endpoints de la plataforma ScrumFlow.',
    },
    servers: [
      {
        url: 'https://localhost:3000',
        description: 'Servidor Local HTTPS',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
        },
      },
    },
  },
  apis: ['./src/modulos/**/*.routes.js', './src/modulos/**/*.controller.js', './src/app.js'],
};

const especificacionSwagger = swaggerJSDoc(opciones);

/**
 * Registra la interfaz de Swagger UI en la app de Express.
 * @param {import('express').Express} app 
 */
export function configurarSwagger(app) {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(especificacionSwagger));
  console.log('Documentación OpenAPI disponible en https://localhost:3000/api/docs');
}