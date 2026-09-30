import type { Vacancy } from './careers-preview';
/** Explicit manual fixture; never used to publish or translate real vacancies. */
export function withSpanishPreview(jobs: Vacancy[]): Vacancy[] {
  return jobs.map(job => job.id === 'hvac-technician' ? { ...job, editorialVersion: 1, translations: { es: {
      status: 'Approved', sourceVersion: 1, title: 'Técnico HVAC', department: 'Operaciones de campo', location: 'Aruba', contract: 'Tiempo completo',
      summary: 'Instala, realiza mantenimiento y diagnostica sistemas de aire acondicionado en Aruba.',
      responsibilities: ['Instala, realiza mantenimiento y diagnostica sistemas de aire acondicionado en Aruba.', 'Comunícate con claridad y mantén registros precisos del trabajo.', 'Sigue los procedimientos acordados de calidad, seguridad y trabajo en equipo.'],
      requirements: ['Experiencia relacionada con las responsabilidades del puesto.', 'Comunicación clara y una forma de trabajar práctica y organizada.'], desired: [],
      questions: [
        { id: 'systems', label: '¿Con qué sistemas has trabajado?', help: '', optionLabels: { 'Split units': 'Unidades split', 'Cassette units': 'Unidades cassette', 'VRF / VRV': 'VRF / VRV', 'Ducted systems': 'Sistemas con ductos' } },
        { id: 'drawings', label: '¿Puedes leer planos técnicos?', help: '', optionLabels: { Yes: 'Sí', No: 'No' } },
        { id: 'project', label: 'Cuéntanos brevemente sobre un proyecto relacionado.', help: '', optionLabels: {} },
      ],
    } } } : job);
}
