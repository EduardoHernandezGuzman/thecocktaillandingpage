const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { openai } = require('./openaiClient');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// IDs de los Assistants de OpenAI
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const ASSISTANT_INTERACTION_ID = process.env.ASSISTANT_INTERACTION_ID;
const ASSISTANT_ANALYTICS_ID = process.env.ASSISTANT_ANALYTICS_ID;

// Cache temporal para almacenar analytics pendientes
const analyticsCache = new Map();

// Limpieza automática del cache cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of analyticsCache.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      analyticsCache.delete(key);
    }
  }
}, 60 * 1000);

// =================================================================================
// FUNCIÓN: Ejecutar agentes de analytics en background (no bloquea)
// =================================================================================
async function runAnalyticsAgentsInBackground(messageId, userMessage, botReply, donationDetails) {
  const results = { interaction: null, analytics: null, ready: false };

  try {
    // Ejecutamos AMBOS agentes en PARALELO
    const [interactionResult, funnelResult] = await Promise.allSettled([
      // Agente de Interacción
      (async () => {
        const interactionThread = await openai.beta.threads.create();

        const contextoInteraccion = `
          ANALIZA ESTA INTERACCIÓN EN UNA WEB DE DONACIONES/ONG:
          - Usuario dijo: "${userMessage}"
          - Chatbot respondió: "${botReply}"
          
          Genera el objeto JSON de chatbot_interaction según tus instrucciones.
        `;

        await openai.beta.threads.messages.create(interactionThread.id, {
          role: 'user',
          content: contextoInteraccion,
        });

        const runInteraction = await openai.beta.threads.runs.createAndPoll(interactionThread.id, {
          assistant_id: ASSISTANT_INTERACTION_ID,
        });

        if (runInteraction.status === 'completed') {
          const iMessages = await openai.beta.threads.messages.list(interactionThread.id);
          const iMsg = iMessages.data[0];

          if (iMsg && iMsg.content[0].type === 'text') {
            let jsonRaw = iMsg.content[0].text.value;
            jsonRaw = jsonRaw.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonRaw);
          }
        }
        return null;
      })(),

      // Agente de Funnel (adaptado para donaciones)
      (async () => {
        const analyticsThread = await openai.beta.threads.create();

        const donationDetailsJson = donationDetails ? JSON.stringify(donationDetails) : 'null';

        const contextoFunnel = `
          ANALIZA ESTA INTERACCIÓN PARA DETECTAR EVENTOS DE FUNNEL DE DONACIONES:
          
          - Usuario dijo: "${userMessage}"
          - Chatbot respondió: "${botReply}"
          - Detalles de donación (donationDetails): ${donationDetailsJson}
          
          EVENTOS POSIBLES PARA ONG/DONACIONES:
          - donation_interest: Usuario muestra interés en donar
          - donation_info_request: Usuario pide información sobre cómo donar
          - project_interest: Usuario pregunta sobre proyectos específicos
          - volunteer_interest: Usuario pregunta sobre voluntariado
          - contact_request: Usuario quiere contactar
          
          Si detectas un evento relevante, devuelve el JSON con los datos.
          Si NO hay evento de funnel, devuelve: {"event": null}
        `;

        await openai.beta.threads.messages.create(analyticsThread.id, {
          role: 'user',
          content: contextoFunnel,
        });

        const runAnalytics = await openai.beta.threads.runs.createAndPoll(analyticsThread.id, {
          assistant_id: ASSISTANT_ANALYTICS_ID,
        });

        if (runAnalytics.status === 'completed') {
          const aMessages = await openai.beta.threads.messages.list(analyticsThread.id);
          const aMsg = aMessages.data[0];

          if (aMsg && aMsg.content[0].type === 'text') {
            let jsonRaw = aMsg.content[0].text.value;
            jsonRaw = jsonRaw.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(jsonRaw);

            if (parsed.event && parsed.event !== null) {
              return parsed;
            }
          }
        }
        return null;
      })()
    ]);

    // Procesamos resultados
    if (interactionResult.status === 'fulfilled' && interactionResult.value) {
      results.interaction = interactionResult.value;
    }

    if (funnelResult.status === 'fulfilled' && funnelResult.value) {
      results.analytics = funnelResult.value;
    }

  } catch (err) {
    console.error('Error en analytics background:', err);
  }

  // Actualizamos el cache
  const cached = analyticsCache.get(messageId);
  if (cached) {
    cached.interaction = results.interaction;
    cached.analytics = results.analytics;
    cached.ready = true;
    cached.timestamp = Date.now();
  } else {
    results.ready = true;
    results.timestamp = Date.now();
    analyticsCache.set(messageId, results);
  }
}

// =================================================================================
// ENDPOINT: Chat principal
// =================================================================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, threadId: clientThreadId } = req.body;

    if (!message) return res.status(400).json({ error: 'Falta el mensaje' });

    // Verificar que tenemos el Assistant ID
    if (!ASSISTANT_ID) {
      console.error('ASSISTANT_ID no configurado');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    let mainThreadId = clientThreadId;

    // 1. Crear hilo si no existe
    if (!mainThreadId) {
      const thread = await openai.beta.threads.create();
      mainThreadId = thread.id;
    }

    // 2. Añadir mensaje del usuario
    await openai.beta.threads.messages.create(mainThreadId, {
      role: 'user',
      content: message,
    });

    // 3. Ejecutar Assistant principal
    const runBot = await openai.beta.threads.runs.createAndPoll(mainThreadId, {
      assistant_id: ASSISTANT_ID,
    });

    if (runBot.status !== 'completed') {
      throw new Error(`El chatbot falló con estado: ${runBot.status}`);
    }

    // 4. Recuperar respuesta
    const messagesBot = await openai.beta.threads.messages.list(mainThreadId, {
      order: 'desc',
      limit: 10
    });

    const botMsgObj = messagesBot.data.find((m) => m.role === 'assistant');

    let botReply = "Lo siento, hubo un error de comunicación.";
    let donationDetails = null;

    if (botMsgObj && botMsgObj.content[0].type === 'text') {
      const rawContent = botMsgObj.content[0].text.value;

      // Intentamos parsear como JSON (si el assistant devuelve formato estructurado)
      try {
        let cleanJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        botReply = parsed.response || rawContent;
        donationDetails = parsed.donationDetails || null;
      } catch (e) {
        // Si no es JSON válido, usamos el texto tal cual
        botReply = rawContent;
        donationDetails = null;
      }

      // Limpiar markdown de imágenes
      botReply = botReply.replace(/!\[.*?\]\(.*?\)/g, '').trim();
      botReply = botReply.replace(/\n{3,}/g, '\n\n');
    }

    // =================================================================================
    // FASE 2: GENERAR ID ÚNICO Y LANZAR ANALYTICS EN BACKGROUND
    // =================================================================================
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Inicializamos el cache ANTES de lanzar el proceso
    analyticsCache.set(messageId, {
      interaction: null,
      analytics: null,
      ready: false,
      timestamp: Date.now()
    });

    // Lanzamos los agentes en background (solo si están configurados)
    if (ASSISTANT_INTERACTION_ID && ASSISTANT_ANALYTICS_ID) {
      setImmediate(() => {
        runAnalyticsAgentsInBackground(messageId, message, botReply, donationDetails);
      });
    } else {
      // Si no hay agentes de analytics, marcamos como ready inmediatamente
      analyticsCache.get(messageId).ready = true;
    }

    // =================================================================================
    // FASE 3: RESPUESTA INMEDIATA AL FRONTEND
    // =================================================================================
    return res.json({
      reply: botReply,
      donationDetails: donationDetails,
      threadId: mainThreadId,
      messageId: messageId,
    });

  } catch (err) {
    console.error('--- ERROR CRÍTICO EN /api/chat ---');
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =================================================================================
// ENDPOINT: Obtener analytics de un mensaje (polling desde frontend)
// =================================================================================
app.get('/api/chat/analytics/:messageId', (req, res) => {
  const { messageId } = req.params;
  const cached = analyticsCache.get(messageId);

  if (!cached) {
    return res.json({ ready: false, interaction: null, analytics: null });
  }

  if (!cached.ready) {
    return res.json({ ready: false, interaction: null, analytics: null });
  }

  // Está listo - devolver y marcar como entregado
  if (!cached.delivered) {
    cached.delivered = true;
    // Borrar del cache después de 10 segundos
    setTimeout(() => {
      analyticsCache.delete(messageId);
    }, 10000);
  }

  return res.json({
    ready: true,
    interaction: cached.interaction,
    analytics: cached.analytics
  });
});

// =================================================================================
// HEALTH CHECK
// =================================================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    assistantConfigured: !!ASSISTANT_ID,
    analyticsConfigured: !!(ASSISTANT_INTERACTION_ID && ASSISTANT_ANALYTICS_ID)
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server en http://localhost:${PORT}`));
