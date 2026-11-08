import { formatearContadorWIP, evaluarEstadoWIP, validarInputLimite } from './public/js/pages/tablero/wip.js';

console.log("--- PRUEBAS HU-22: Límite WIP ---");

// 1. Mostrar el contador (Ej. "3/4")
console.log("Contador con límite:", formatearContadorWIP(3, 4) === "3/4" ? "✅ Pasa" : "❌ Falla");
console.log("Contador sin límite:", formatearContadorWIP(3, null) === "3" ? "✅ Pasa" : "❌ Falla");

// 2. Límite blando: permite el movimiento pero avisa
// Simula meter la tarjeta 5 en una columna con límite de 4
const pruebaBlando = evaluarEstadoWIP(4, 4, false); 
console.log("Límite blando superado:", (pruebaBlando.permitido === true && pruebaBlando.alertaBlanda === true) ? "✅ Pasa" : "❌ Falla");

// 3. Límite duro: bloquea el movimiento
// Simula meter la tarjeta 5 en una columna con límite de 4
const pruebaDuro = evaluarEstadoWIP(4, 4, true); 
console.log("Límite duro superado:", (pruebaDuro.permitido === false && pruebaDuro.alertaBlanda === false) ? "✅ Pasa" : "❌ Falla");

// 4. Validación de inputs (no permite 0 ni decimales ni negativos)
console.log("Input válido (3):", validarInputLimite(3) === true ? "✅ Pasa" : "❌ Falla");
console.log("Input inválido (0):", validarInputLimite(0) === false ? "✅ Pasa" : "❌ Falla");
console.log("Input inválido (-2):", validarInputLimite(-2) === false ? "✅ Pasa" : "❌ Falla");