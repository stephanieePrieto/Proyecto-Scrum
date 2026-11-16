/**
 * @file respaldo-cli.js
 * @description CLI para gestionar respaldos y restauración de la base de datos ScrumFlow.
 *
 * Uso:
 *   node scripts/respaldo-cli.js crear
 *   node scripts/respaldo-cli.js listar
 *   node scripts/respaldo-cli.js limpiar [cantidadAConservar]
 *   node scripts/respaldo-cli.js restaurar <nombre-archivo.json>
 * 
 * @author Stephanie Elizdeth Hernández Prieto
 */

import '../src/config/env.js';
import {
  generarRespaldoBaseDatos,
  listarRespaldos,
  limpiarRespaldosAntiguos,
  restaurarRespaldo,
} from '../src/services/respaldo.service.js';

const [, , comando = 'crear', argumento] = process.argv;

async function ejecutar() {
  try {
    switch (comando) {
      case 'crear': {
        console.log('Generando respaldo de PostgreSQL...');
        const resultado = await generarRespaldoBaseDatos('cli');
        console.log('Respaldo completado exitosamente:');
        console.table([resultado]);
        break;
      }

      case 'listar': {
        const respaldos = listarRespaldos();
        if (respaldos.length === 0) {
          console.log('No hay respaldos registrados en la carpeta /backups.');
        } else {
          console.table(
            respaldos.map(({ archivo, tamanoBytes, fechaCreacion }) => ({
              archivo,
              tamanoKB: (tamanoBytes / 1024).toFixed(2),
              fechaCreacion,
            }))
          );
        }
        break;
      }

      case 'limpiar': {
        const conservar = Number.parseInt(argumento, 10) || 10;
        const resumen = limpiarRespaldosAntiguos(conservar);
        console.log(
          `Limpieza finalizada: ${resumen.eliminados} eliminados, ${resumen.conservados} conservados.`
        );
        break;
      }

      case 'restaurar': {
        if (!argumento) {
          console.error('Debes indicar el nombre del archivo. Ejemplo:');
          console.error('  node scripts/respaldo-cli.js restaurar respaldo-cli-2026-11-14.json');
          process.exit(1);
        }
        console.log(`Restaurando base de datos desde ${argumento}...`);
        const resumen = await restaurarRespaldo(argumento);
        console.log('Restauración completada:', resumen);
        break;
      }

      default:
        console.log('Comandos disponibles: crear | listar | limpiar [N] | restaurar <archivo>');
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('[Error CLI Respaldos]:', error.message);
    process.exit(1);
  }
}

ejecutar();