import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * @file correo.js
 * @description Utilidad para el envío de correos electrónicos transaccionales.
 * Soporta envío por SMTP o simulación en consola para desarrollo.
 * @author Citlaly Morales Viveros
 */

const crearTransportador = () => {
    if (env.CORREO_MODO === 'smtp') {
        return nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SEGURO,
            auth: {
                user: env.SMTP_USUARIO,
                pass: env.SMTP_CLAVE,
            },
        });
    }

    return {
        sendMail: async (opciones) => {
            console.log('\n--- SIMULACIÓN DE ENVÍO DE CORREO ---');
            console.log(`De: ${opciones.from}`);
            console.log(`Para: ${opciones.to}`);
            console.log(`Asunto: ${opciones.subject}`);
            console.log(`Cuerpo:\n${opciones.text || opciones.html}`);
            console.log('-------------------------------------\n');
            return { messageId: 'simulado' };
        }
    };
};

const transportador = crearTransportador();

/**
 * Envía un correo electrónico.
 *
 * @param {Object} opciones
 * @param {string} opciones.para - Dirección de correo del destinatario.
 * @param {string} opciones.asunto - Asunto del correo.
 * @param {string} [opciones.texto] - Cuerpo del correo en texto plano.
 * @param {string} [opciones.html] - Cuerpo del correo en formato HTML.
 * @returns {Promise<Object>} Resultado del envío.
 */
export const enviarCorreo = async ({ para, asunto, texto, html }) => {
    const opcionesCorreo = {
        from: env.CORREO_REMITENTE,
        to: para,
        subject: asunto,
        text: texto,
        html: html,
    };

    return await transportador.sendMail(opcionesCorreo);
};