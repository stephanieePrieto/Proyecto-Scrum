/**
 * @file jest.config.js
 * @description Configuración centralizada del ejecutable de pruebas Jest para entornos Node.js con ES Modules.
 * Establece la recolección automática de cobertura de código (code coverage) y fija un umbral mínimo 
 * obligatorio del 70% en líneas, funciones, declaraciones y ramas para validar la calidad de la lógica de negocio.
 * @author Stephanie Elizdeth Hernández Prieto
 */

export default {
  /**
   * Indica a Jest que no transforme los archivos con Babel, ya que el proyecto utiliza 
   * sintaxis nativa de ES Modules (import / export) mediante Node.js ('"type": "module"').
   */
  transform: {},

  /**
   * Define el entorno de ejecución donde se procesarán las pruebas unitarias.
   * Al ser un servicio de backend, se configura en un entorno nativo de Node.js en lugar de un navegador (jsdom).
   */
  testEnvironment: 'node',

  /**
   * Habilita la recolección automática de la cobertura de código cada vez que se ejecute el comando 'npm test'.
   */
  collectCoverage: true,

  /**
   * Directorio donde Jest generará y guardará los reportes impresos e interactivos de cobertura de código (HTML, LCOV, JSON).
   */
  coverageDirectory: 'coverage',

  /**
   * Define qué archivos deben ser analizados para auditar el porcentaje de cobertura.
   * Se incluye toda la capa de lógica de negocio (módulos y utilidades) y se excluyen explícitamente 
   * las definiciones de rutas y archivos de configuración para no sesgar las métricas del negocio.
   */
  collectCoverageFrom: [
    'src/modulos/**/*.js',
    'src/utils/**/*.js',
    '!src/modulos/**/*.routes.js', // Excluye la definición de endpoints (capa HTTP)
  ],

  /**
   * UMBRAL MÍNIMO DE COBERTURA OBLIGATORIO (70%):
   * Especifica los límites requeridos para que la suite de pruebas se considere aprobada.
   * Si cualquiera de los 4 indicadores globales cae por debajo del 70%, Jest devolverá un código de salida con error (exit status 1).
   */
  coverageThreshold: {
    global: {
      branches: 70,   // Cobertura mínima en decisiones condicionales (if / else / switch)
      functions: 70,  // Cobertura mínima en funciones y métodos ejecutados
      lines: 70,      // Cobertura mínima en líneas de código procesadas
      statements: 70, // Cobertura mínima en declaraciones e instrucciones
    },
  },
};