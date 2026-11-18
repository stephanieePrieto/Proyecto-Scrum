import { describe, test, expect } from '@jest/globals';
import { exigirPropietarioTarea, ROLES } from './permisos.js';

describe('Permisos de modificación de tareas', () => {
  test('el Scrum Master puede modificar una tarea de cualquier responsable', () => {
    expect(() => exigirPropietarioTarea({ id: 1 }, { responsable_id: 2 }, ROLES.SCRUM_MASTER)).not.toThrow();
  });

  test('una persona puede modificar solo una tarea que tiene asignada', () => {
    expect(() => exigirPropietarioTarea({ id: 2 }, { responsable_id: 2 }, ROLES.DEVELOPER)).not.toThrow();
    expect(() => exigirPropietarioTarea({ id: 2 }, { responsable_id: 3 }, ROLES.DEVELOPER))
      .toThrow('Solo puedes modificar tus propias tareas.');
    expect(() => exigirPropietarioTarea({ id: 2 }, { responsable_id: null }, ROLES.DEVELOPER))
      .toThrow('Solo puedes modificar tus propias tareas.');
  });
});
