/**
 * CHATBOT TCK ONG
 * Adaptado para landing de donaciones/ONG
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const toggle = $('tck-chat-toggle');
  const widget = $('tck-chat-widget');
  const backdrop = $('tck-chat-backdrop');
  const closeBtn = $('tck-chat-close');
  const resetBtn = $('tck-chat-reset');
  const form = $('tck-chat-form');
  const input = $('tck-chat-input');
  const messagesEl = $('tck-chat-messages');
  const quickActions = $('tck-quick-actions');

  // Verificar elementos requeridos
  if (!toggle || !widget || !backdrop || !closeBtn || !form || !input || !messagesEl) {
    console.warn('Chatbot: Faltan elementos del DOM');
    return;
  }

  // ===========================================
  // STATE
  // ===========================================
  const state = {
    sending: false,
    open: false,
    threadId: null,
    conversationId: null
  };

  let messages = [];

  // Storage keys
  const CID_KEY = 'tck_conversation_id';
  const TID_KEY = 'tck_thread_id';
  const MSG_KEY = 'tck_chat_messages';

  // ===========================================
  // HELPERS
  // ===========================================
  function newConversationId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function getOrCreateConversationId() {
    let cid = sessionStorage.getItem(CID_KEY);
    if (!cid) {
      cid = newConversationId();
      sessionStorage.setItem(CID_KEY, cid);
    }
    return cid;
  }

  function resetConversationId() {
    const cid = newConversationId();
    sessionStorage.setItem(CID_KEY, cid);
    return cid;
  }

  function getThreadId() {
    return sessionStorage.getItem(TID_KEY);
  }

  function setThreadId(tid) {
    if (tid) sessionStorage.setItem(TID_KEY, tid);
  }

  function clearThreadId() {
    sessionStorage.removeItem(TID_KEY);
  }

  function getStoredMessages() {
    try {
      const stored = sessionStorage.getItem(MSG_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  function saveMessages() {
    try {
      sessionStorage.setItem(MSG_KEY, JSON.stringify(messages));
    } catch (e) {
      console.error('Error saving messages:', e);
    }
  }

  function clearStoredMessages() {
    sessionStorage.removeItem(MSG_KEY);
  }

  // ===========================================
  // PUSH EVENT TO DATALAYER
  // ===========================================
  function pushEvent(name, data = {}) {
    try {
      if (window.dataLayer) {
        window.dataLayer.push({ event: name, ...data });
      }
    } catch (_) {}
  }

  // ===========================================
  // POLLING PARA ANALYTICS (background)
  // ===========================================
  async function pollForAnalytics(messageId, maxAttempts = 30, intervalMs = 500) {
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) return;
      attempts++;

      try {
        const res = await fetch(`/api/chat/analytics/${messageId}`);
        if (!res.ok) {
          if (attempts < maxAttempts) setTimeout(poll, intervalMs);
          return;
        }

        const data = await res.json();

        if (!data.ready) {
          setTimeout(poll, intervalMs);
          return;
        }

        // AGENTE 1: INTERACCIÓN
        if (data.interaction && window.dataLayer) {
          window.dataLayer.push({
            ...data.interaction,
            conversation_id: state.conversationId
          });
        }

        // AGENTE 2: FUNNEL
        if (data.analytics && data.analytics.event && window.dataLayer) {
          window.dataLayer.push({
            ...data.analytics,
            conversation_id: state.conversationId
          });
        }

      } catch (err) {
        if (attempts < maxAttempts) setTimeout(poll, intervalMs);
      }
    };

    // Empezar después de un pequeño delay
    setTimeout(poll, 800);
  }

  // ===========================================
  // MESSAGE FUNCTIONS
  // ===========================================
  function addMessage(text, who = 'bot', type = 'normal') {
    const div = document.createElement('div');
    div.className = type === 'status' ? 'tck-msg status' : `tck-msg ${who}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'tck-msg bot';
    const inner = document.createElement('div');
    inner.className = 'tck-typing';
    inner.innerHTML = `
      <span class="tck-typing-dot"></span>
      <span class="tck-typing-dot"></span>
      <span class="tck-typing-dot"></span>
    `;
    wrap.appendChild(inner);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrap;
  }

  // Crear tarjeta informativa (para donaciones, proyectos, etc.)
  function createInfoCard(info) {
    // Debug: ver qué llega
    console.log('createInfoCard recibe:', info);
    
    // Validación estricta: debe ser un objeto con contenido
    if (!info || typeof info !== 'object') return null;
    
    // Soportar tanto 'title' como 'name' del objeto
    const title = info.title || info.name;
    
    // Si no hay título válido, no mostramos tarjeta
    if (!title || typeof title !== 'string' || title.trim() === '') return null;

    const card = document.createElement('div');
    card.className = 'tck-info-card';

    const description = info.description || '';
    const objective = info.objective || '';
    const actionText = info.actionText || 'Más información';
    const actionUrl = info.actionUrl || '#contacto';
    const projectType = info.type || 'proyecto';

    // Icono según tipo
    let icon = '📋';
    if (projectType === 'donación') icon = '💝';
    else if (projectType === 'voluntariado') icon = '🙋';
    else if (projectType === 'contacto') icon = '📧';
    else if (projectType === 'proyecto') icon = '🌟';

    card.innerHTML = `
      <div class="tck-info-card-content">
        <div class="tck-info-card-header">
          <span class="tck-info-card-icon">${icon}</span>
          <h4 class="tck-info-card-title">${title}</h4>
        </div>
        ${description ? `<p class="tck-info-card-desc">${description}</p>` : ''}
        ${objective ? `<p class="tck-info-card-objective"><strong>Objetivo:</strong> ${objective}</p>` : ''}
        <div class="tck-info-card-actions">
          <a href="${actionUrl}" class="tck-info-card-btn primary">${actionText}</a>
        </div>
      </div>
    `;

    // Evento de click
    const actionBtn = card.querySelector('.tck-info-card-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        pushEvent('chatbot_cta_click', {
          conversation_id: state.conversationId,
          cta_type: projectType,
          cta_title: title,
          project_id: info.id || null
        });
      });
    }

    return card;
  }

  // Crear múltiples tarjetas (cuando donationDetails es un array)
  function createInfoCards(donationDetails) {
    console.log('createInfoCards recibe:', donationDetails);
    
    if (!donationDetails) return [];
    
    // Si es un array, crear una tarjeta por cada elemento
    if (Array.isArray(donationDetails)) {
      return donationDetails
        .map(item => createInfoCard(item))
        .filter(card => card !== null);
    }
    
    // Si es un objeto único, crear una sola tarjeta
    const card = createInfoCard(donationDetails);
    return card ? [card] : [];
  }

  // Restaurar mensajes guardados
  function restoreMessages() {
    if (messages.length > 0) {
      messages.forEach((msg) => {
        const div = document.createElement('div');
        div.className = `tck-msg ${msg.role === 'user' ? 'user' : 'bot'}`;
        div.textContent = msg.content;
        messagesEl.appendChild(div);

        // Restaurar tarjetas si las hay (soporta array o objeto único)
        if (msg.infoCard) {
          const cards = createInfoCards(msg.infoCard);
          cards.forEach(card => {
            messagesEl.appendChild(card);
          });
        }
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ===========================================
  // OPEN / CLOSE CHAT
  // ===========================================
  function openChat() {
    if (state.open) return;

    if (!state.conversationId) {
      state.conversationId = getOrCreateConversationId();
    }

    // Bloquear scroll del body
    document.body.style.overflow = 'hidden';

    backdrop.classList.remove('tck-hidden');
    widget.classList.remove('tck-hidden');

    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      widget.classList.add('open');
      setTimeout(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 50);
    });

    widget.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    state.open = true;

    pushEvent('chat_opened', { conversation_id: state.conversationId });

    // Mensaje de bienvenida SOLO si no hay mensajes en el DOM ni en memoria
    if (messages.length === 0 && messagesEl.children.length === 0) {
      const welcomeMsg = '¡Hola! 👋 Soy el asistente de TCK ONG. ¿En qué puedo ayudarte hoy?';
      addMessage(welcomeMsg, 'bot');
      
      // Guardamos el mensaje de bienvenida para que no se repita
      messages.push({ role: 'assistant', content: welcomeMsg });
      saveMessages();
      
      // Mostrar quick actions
      if (quickActions) {
        quickActions.style.display = 'flex';
      }
    }

    setTimeout(() => {
      input.focus();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 150);

    document.addEventListener('keydown', onEsc);
  }

  function closeChat() {
    if (!state.open) return;

    // Restaurar scroll del body
    document.body.style.overflow = '';

    backdrop.classList.remove('show');
    widget.classList.remove('open');

    widget.addEventListener('transitionend', () => {
      backdrop.classList.add('tck-hidden');
      widget.classList.add('tck-hidden');
    }, { once: true });

    widget.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    state.open = false;

    pushEvent('chat_closed', { conversation_id: state.conversationId });
    document.removeEventListener('keydown', onEsc);
  }

  function onEsc(e) {
    if (e.key === 'Escape') closeChat();
  }

  // ===========================================
  // QUICK ACTIONS
  // ===========================================
  function handleQuickAction(action) {
    if (state.sending) return;
    
    let message = '';
    switch (action) {
      case 'donate':
        message = '¿Cómo puedo hacer una donación?';
        break;
      case 'projects':
        message = '¿Qué proyectos tienen activos?';
        break;
      case 'volunteer':
        message = '¿Cómo puedo ser voluntario?';
        break;
      case 'contact':
        message = 'Quiero contactar con ustedes';
        break;
      default:
        return;
    }

    input.value = message;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    
    // Ocultar quick actions después de usar una
    if (quickActions) {
      quickActions.style.display = 'none';
    }
  }

  // ===========================================
  // SEND MESSAGE
  // ===========================================
  async function sendMessage(text) {
    if (state.sending || !text.trim()) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    input.disabled = true;
    input.value = '';

    if (!state.conversationId) {
      state.conversationId = getOrCreateConversationId();
    }

    // Guardar mensaje del usuario
    messages.push({ role: 'user', content: text });
    saveMessages();
    addMessage(text, 'user');

    // Ocultar quick actions
    if (quickActions) {
      quickActions.style.display = 'none';
    }

    const typingEl = showTyping();
    state.sending = true;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          threadId: state.threadId,
          conversation_id: state.conversationId,
        }),
      });

      const data = await res.json();
      typingEl.remove();

      if (!res.ok || data.error) {
        const msg = data.error || `Error ${res.status}`;
        addMessage(`Error: ${msg}`, 'bot');
        pushEvent('chat_error', {
          status: res.status,
          message: msg,
          conversation_id: state.conversationId
        });
        return;
      }

      const reply = data.reply || 'Lo siento, no pude responder ahora.';

      // Guardar threadId
      if (data.threadId) {
        state.threadId = data.threadId;
        setThreadId(data.threadId);
      }

      addMessage(reply, 'bot');

      // Info cards (soporta objeto único o array de proyectos)
      if (data.donationDetails) {
        const items = Array.isArray(data.donationDetails) 
          ? data.donationDetails 
          : [data.donationDetails];
        
        items.forEach(item => {
          const title = item.title || item.name;
          if (!title) return;
          
          let icon = '🌟';
          if (item.type === 'donación') icon = '💝';
          else if (item.type === 'voluntariado') icon = '🙋';
          else if (item.type === 'contacto') icon = '📧';
          
          const card = document.createElement('div');
          card.style.cssText = `
            background: #374151;
            border-radius: 12px;
            padding: 16px;
            margin: 8px 0;
            border: 1px solid rgba(255,255,255,0.2);
            max-width: 90%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          `;
          
          card.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <span style="font-size:22px;">${icon}</span>
              <h4 style="color:#fff;font-size:15px;font-weight:600;margin:0;">${title}</h4>
            </div>
            ${item.description ? `<p style="color:#9ca3af;font-size:13px;margin:0 0 10px 0;line-height:1.5;">${item.description}</p>` : ''}
            ${item.objective ? `<p style="color:#f59e0b;font-size:12px;margin:0 0 12px 0;padding:10px;background:rgba(245,158,11,0.15);border-radius:8px;border-left:3px solid #f59e0b;"><strong style="color:#fff;">Objetivo:</strong> ${item.objective}</p>` : ''}
            <a href="#contacto" style="display:inline-block;background:#f59e0b;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">Más información</a>
          `;
          
          messagesEl.appendChild(card);
        });
        
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      // Guardar mensaje del bot
      messages.push({
        role: 'assistant',
        content: reply,
        infoCard: data.donationDetails || null
      });
      saveMessages();

      // Polling para analytics (en background)
      if (data.messageId) {
        pollForAnalytics(data.messageId);
      }

    } catch (err) {
      typingEl.remove();
      addMessage('Error al conectar con el servidor. Intenta de nuevo.', 'bot');
      console.error('Chat error:', err);
      pushEvent('chat_error', {
        message: String(err),
        conversation_id: state.conversationId
      });
    } finally {
      state.sending = false;
      input.disabled = false;
      if (submitBtn) submitBtn.disabled = false;
      input.focus();
    }
  }

  // ===========================================
  // INITIALIZE
  // ===========================================
  state.conversationId = getOrCreateConversationId();
  state.threadId = getThreadId();
  messages = getStoredMessages();

  // Restaurar mensajes si existen
  restoreMessages();

  // ===========================================
  // EVENT LISTENERS
  // ===========================================
  toggle.addEventListener('click', () => {
    state.open ? closeChat() : openChat();
  });

  closeBtn.addEventListener('click', closeChat);
  backdrop.addEventListener('click', closeChat);

  // Reset conversation
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.conversationId = resetConversationId();
      state.threadId = null;
      clearThreadId();
      messages.length = 0;
      clearStoredMessages();
      messagesEl.innerHTML = '';

      addMessage('Nueva conversación iniciada. ¿En qué puedo ayudarte?', 'bot');
      
      if (quickActions) {
        quickActions.style.display = 'flex';
      }

      pushEvent('chat_new_conversation', { conversation_id: state.conversationId });
      setTimeout(() => input.focus(), 50);
    });
  }

  // Form submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(input.value.trim());
  });

  // Quick actions
  if (quickActions) {
    quickActions.addEventListener('click', (e) => {
      const btn = e.target.closest('.tck-quick-btn');
      if (btn && btn.dataset.action) {
        handleQuickAction(btn.dataset.action);
      }
    });
  }

  // Exponer para debugging (opcional)
  window.tckChatbot = {
    open: openChat,
    close: closeChat,
    reset: () => resetBtn?.click(),
    getState: () => ({ ...state, messageCount: messages.length })
  };

})();
