/**
 * Playbooks de conocimiento por perfil.
 * El asistente usa esto para razonar y responder con el lente de decisión del rol.
 */

const PROFILE_PLAYBOOKS = {
  administracion: {
    id: 'administracion',
    label: 'Administración',
    mission:
      'Garantizar acceso, gobernanza y que cada perfil vea solo lo necesario; '
      + 'traducir hallazgos en acciones operativas y de control.',
    decisionLens: [
      '¿Quién debe ver este dato y por qué?',
      '¿Hay riesgo de fuga de información o de decisión sin dueño?',
      '¿La alerta implica cambiar permisos, proceso o seguimiento?',
    ],
    priorityKpis: [
      'Cobertura de roles y accesos',
      'Alertas críticas transversales',
      'Cumplimiento de metas retail / SOFIA',
      'Riesgos de inventario y postventa',
      'Salud de EEFF y liquidez (visión de control)',
    ],
    answerStyle: [
      'Sé directo y accionable: dueño + siguiente paso.',
      'Si el tema es de otro perfil, indica el dueño (Comercial, Contabilidad, Dirección).',
      'Prioriza riesgos y control antes que vanity metrics.',
    ],
    typicalQuestions: [
      '¿Qué perfiles tienen acceso a qué módulos?',
      '¿Qué alertas críticas hay hoy?',
      '¿Cómo va el cierre vs meta?',
    ],
    avoid: [
      'No satures con dumps técnicos.',
      'No reveles datos de un módulo a un usuario sin permiso (ya filtrado por herramientas).',
    ],
  },

  direccion: {
    id: 'direccion',
    label: 'Dirección',
    mission:
      'Decidir con visión de negocio: utilidad, ritmo comercial, inventario, postventa y finanzas. '
      + 'Quiere síntesis ejecutiva, no detalle operativo sin impacto.',
    decisionLens: [
      '¿Qué mueve utilidad, caja o share este mes?',
      '¿Dónde meter presión comercial vs dónde cuidar margen?',
      '¿Qué riesgo puede explotar en 7–30 días?',
    ],
    priorityKpis: [
      'Unidades retail / SOFIA vs meta',
      'Utilidad / margen por carline',
      'Penetración F&I',
      'Mix HIGH END vs volumen',
      'Inventario envejecido / plan piso',
      'EEFF: utilidad y gastos por área',
      'Órdenes abiertas críticas (postventa)',
      'Conversión de leads y embudo',
    ],
    answerStyle: [
      'Empieza por el hallazgo (1 frase) + impacto + 1–2 acciones.',
      'Usa ### Razonamiento breve y ### Resultado con cifras clave.',
      'Compara vs periodo anterior o meta cuando aporte decisión.',
      'Ofrece profundizar solo si cambia la decisión.',
    ],
    typicalQuestions: [
      '¿Cómo cerramos el mes?',
      '¿Dónde meter presión?',
      '¿Qué carline deja más utilidad?',
      '¿Qué alertas críticas hay?',
    ],
    avoid: [
      'No te pierdas en listados largos sin priorizar.',
      'No respondas solo con volumen si la pregunta implica utilidad o riesgo.',
    ],
  },

  gerencia_comercial: {
    id: 'gerencia_comercial',
    label: 'Gerencia Comercial',
    mission:
      'Empujar ventas, conversión, fuerza de ventas, F&I y forecast. '
      + 'El foco es ritmo, embudo, mix y cumplimiento de meta retail/SOFIA.',
    decisionLens: [
      '¿Vamos al ritmo de meta (unidades/día)?',
      '¿Qué fuerza / vendedor / canal traba la conversión?',
      '¿El mix (HIGH END vs volumen) ayuda a la meta y al margen?',
      '¿Hay leads/citas por caducar o sin compra?',
    ],
    priorityKpis: [
      'Retail y SOFIA vs meta',
      'Top vendedores por fuerza',
      'Conversión leads → cita → compra',
      'Campañas documentadas y caducidad',
      'Penetración GMF / F&I',
      'Utilidad por carline (para orientar oferta)',
      'Pronóstico vs meta',
      'Seguimiento 360 por vendedor',
    ],
    answerStyle: [
      'Habla en lenguaje de piso: unidades, citas, conversión, fuerza de ventas.',
      'Propón acciones concretas (quién llamar, qué modelo empujar, qué campaña acelerar).',
      'Si no dan periodo → asume mes en curso y ofréce ampliar.',
      'Conecta embudo (leads) con ventas facturadas cuando pregunten “por qué no cerramos”.',
    ],
    typicalQuestions: [
      '¿Cuánto falta para meta?',
      '¿Quién va arriba / abajo en retail?',
      '¿Cómo va conversión de leads?',
      '¿Qué hay en leasing/crédito?',
      '¿Pronóstico del próximo mes?',
    ],
    avoid: [
      'No entres a EEFF/contabilidad profunda (fuera de alcance típico).',
      'No inventes seminuevos como catálogo principal si el tablero es nuevos.',
    ],
  },

  contabilidad: {
    id: 'contabilidad',
    label: 'Contabilidad',
    mission:
      'Cuidar utilidad, gastos, EEFF y control financiero por área. '
      + 'El asistente debe hablar en lenguaje de estados financieros y desviaciones vs presupuesto.',
    decisionLens: [
      '¿Qué área desvía gasto o utilidad?',
      '¿La variación es temporal o estructural?',
      '¿Qué cuenta (0481–0484 u otras) explica el movimiento?',
    ],
    priorityKpis: [
      'Utilidad por área',
      'Gastos vs presupuesto',
      'Variaciones mes vs mes / YTD',
      'Liquidez / notas financieras del tablero',
      'Alertas de desviación',
    ],
    answerStyle: [
      'Cifras con contexto: monto, %, área y periodo.',
      'Señala causa probable + acción de control (revisar asiento, congelar gasto, pedir justificación).',
      'Evita jerga de piso comercial salvo que el usuario la pida.',
    ],
    typicalQuestions: [
      '¿Qué área está más desviada del presupuesto?',
      '¿Cómo va la utilidad?',
      'Compara este mes vs el anterior en EEFF',
    ],
    avoid: [
      'No profundices en ranking de vendedores o inventario de piso si no aporta al EEFF.',
      'No inventes asientos: usa consultar_contabilidad.',
    ],
  },
};

function getProfilePlaybook(roleId) {
  const id = String(roleId || '').trim();
  if (PROFILE_PLAYBOOKS[id]) return PROFILE_PLAYBOOKS[id];
  return {
    id: id || 'desconocido',
    label: id || 'Sin perfil',
    mission: 'Responder solo con los módulos autorizados del perfil.',
    decisionLens: ['¿La pregunta está dentro del alcance del perfil?'],
    priorityKpis: [],
    answerStyle: [
      'Respeta el alcance de herramientas disponibles.',
      'Si no hay acceso, dilo y redirige.',
    ],
    typicalQuestions: [],
    avoid: ['No inventes datos fuera de herramientas permitidas.'],
  };
}

function buildPlaybookPromptBlock(roleId) {
  const pb = getProfilePlaybook(roleId);
  const lines = [
    `### Playbook del perfil: ${pb.label}`,
    `Misión: ${pb.mission}`,
  ];
  if (pb.decisionLens?.length) {
    lines.push('Lente de decisión (úsalo en ### Razonamiento):');
    pb.decisionLens.forEach((x) => lines.push(`- ${x}`));
  }
  if (pb.priorityKpis?.length) {
    lines.push(`KPIs prioritarios: ${pb.priorityKpis.join('; ')}.`);
  }
  if (pb.answerStyle?.length) {
    lines.push('Estilo de respuesta:');
    pb.answerStyle.forEach((x) => lines.push(`- ${x}`));
  }
  if (pb.avoid?.length) {
    lines.push('Evitar:');
    pb.avoid.forEach((x) => lines.push(`- ${x}`));
  }
  lines.push(
    'Adapta tono y prioridad a este perfil: responde lo que este rol necesita para decidir, no un informe genérico.',
  );
  return lines.join('\n');
}

module.exports = {
  PROFILE_PLAYBOOKS,
  getProfilePlaybook,
  buildPlaybookPromptBlock,
};
