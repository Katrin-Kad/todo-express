'use strict';

(() => {
  const TOKEN_KEY = 'todo.token';
  const RUN_KEY = 'todo.runId';
  const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const TITLE_MAX = 200;

  const $ = (id) => document.getElementById(id);
  const els = {
    alert: $('alert'),
    status: $('status'),
    authorBox: $('author-box'),
    authorName: $('author-name'),
    authorLogin: $('author-login'),
    logoutButton: $('logout-button'),
    loginSection: $('login-section'),
    loginForm: $('login-form'),
    tokenInput: $('token-input'),
    tokenError: $('token-error'),
    tasksSection: $('tasks-section'),
    tasksTitle: $('tasks-title'),
    runForm: $('run-form'),
    runInput: $('run-input'),
    runError: $('run-error'),
    addForm: $('add-form'),
    addInput: $('add-input'),
    addError: $('add-error'),
    summary: $('summary'),
    list: $('task-list'),
    emptyNote: $('empty-note'),
    template: $('task-template'),
  };

  const state = { token: null, runId: 'manual', tasks: [] };

  // ---------- хранение в пределах вкладки ----------
  const storage = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* недоступно */ } },
    remove(key) { try { sessionStorage.removeItem(key); } catch { /* недоступно */ } },
  };

  // ---------- сообщения ----------
  function announce(message) {
    // Очистка и повторная запись заставляют экранный диктор прочитать одинаковые сообщения.
    els.status.textContent = '';
    window.setTimeout(() => { els.status.textContent = message; }, 50);
  }

  function showAlert(message) {
    els.alert.textContent = message;
    els.alert.hidden = false;
  }

  function hideAlert() {
    els.alert.hidden = true;
    els.alert.textContent = '';
  }

  function setFieldError(input, errorEl, message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  }

  // ---------- API ----------
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(method, path, body) {
    const headers = { Authorization: `Bearer ${state.token}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(path, init);
    } catch {
      throw new ApiError(0, 'Нет связи с сервером. Проверьте подключение к интернету.');
    }

    if (response.status === 204) return null;
    let data = null;
    try { data = await response.json(); } catch { /* тело не JSON */ }

    if (!response.ok) {
      const message = (data && data.error) || `Ошибка ${response.status}`;
      throw new ApiError(response.status, message);
    }
    return data;
  }

  function handleApiError(err, fallback) {
    if (err.status === 401) {
      logout();
      setFieldError(els.tokenInput, els.tokenError, 'Токен не подошел. Введите токен еще раз.');
      els.tokenInput.focus();
      return;
    }
    const detail = err.status === 503 ? 'база данных временно недоступна, попробуйте позже' : err.message;
    showAlert(`${fallback}: ${detail}.`);
  }

  // ---------- проверки на клиенте (дублируют серверные) ----------
  function validateTitle(raw) {
    const title = raw.trim();
    const length = [...title].length;
    if (length === 0) return { error: 'Введите название дела.' };
    if (length > TITLE_MAX) return { error: `Не больше ${TITLE_MAX} символов (сейчас ${length}).` };
    return { title };
  }

  // ---------- отрисовка ----------
  const timeFormat = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  function renderSummary() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.done).length;
    els.summary.textContent = total
      ? `Набор «${state.runId}»: всего ${total}, выполнено ${done}.`
      : `Набор «${state.runId}».`;
    els.emptyNote.hidden = total > 0;
  }

  function fillTaskItem(li, task) {
    li.dataset.id = task.id;
    li.classList.toggle('task--done', task.done);

    const check = li.querySelector('.task__check');
    const label = li.querySelector('.task__title');
    const time = li.querySelector('.task__time');
    const editButton = li.querySelector('[data-action="edit"]');
    const deleteButton = li.querySelector('[data-action="delete"]');

    check.id = `done-${task.id}`;
    check.checked = task.done;
    label.htmlFor = check.id;
    label.textContent = task.title;

    const created = new Date(task.createdAt);
    time.dateTime = task.createdAt;
    time.textContent = Number.isNaN(created.getTime()) ? '' : timeFormat.format(created);

    // Видимый текст кнопки входит в начало доступного имени (WCAG 2.5.3).
    editButton.setAttribute('aria-label', `Изменить «${task.title}»`);
    deleteButton.setAttribute('aria-label', `Удалить «${task.title}»`);

    const editInput = li.querySelector('.task__edit .input');
    const editLabel = li.querySelector('.task__edit label');
    const editError = li.querySelector('.task__edit-error');
    editInput.id = `edit-${task.id}`;
    editLabel.htmlFor = editInput.id;
    editError.id = `edit-error-${task.id}`;
    editInput.setAttribute('aria-describedby', editError.id);
  }

  function createTaskItem(task) {
    const li = els.template.content.firstElementChild.cloneNode(true);
    fillTaskItem(li, task);
    return li;
  }

  function renderList() {
    els.list.replaceChildren(...state.tasks.map(createTaskItem));
    renderSummary();
  }

  function findItem(id) {
    return els.list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  }

  function replaceTask(task) {
    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) state.tasks[index] = task;
    const li = findItem(task.id);
    if (li) fillTaskItem(li, task);
    renderSummary();
  }

  // ---------- сценарии ----------
  async function loadTasks() {
    els.list.setAttribute('aria-busy', 'true');
    try {
      state.tasks = await api('GET', `/api/tasks/?runId=${encodeURIComponent(state.runId)}`);
      renderList();
      return true;
    } catch (err) {
      handleApiError(err, 'Не удалось загрузить дела');
      return false;
    } finally {
      els.list.removeAttribute('aria-busy');
    }
  }

  async function login(token, { silent = false } = {}) {
    state.token = token;
    try {
      const author = await api('GET', '/api/author/');
      storage.set(TOKEN_KEY, token);
      els.authorName.textContent = author.fullName;
      els.authorLogin.textContent = author.login;
      els.authorBox.hidden = false;
      els.loginSection.hidden = true;
      els.tasksSection.hidden = false;
      els.tokenInput.value = '';
      setFieldError(els.tokenInput, els.tokenError, '');
      hideAlert();
      const loaded = await loadTasks();
      if (loaded && !silent) {
        els.tasksTitle.focus();
        announce(`Вы вошли как ${author.fullName}. Загружено дел: ${state.tasks.length}.`);
      }
    } catch (err) {
      state.token = null;
      storage.remove(TOKEN_KEY);
      if (err.status === 401) {
        setFieldError(els.tokenInput, els.tokenError, 'Неверный токен.');
        if (!silent) els.tokenInput.focus();
      } else {
        showAlert(`Не удалось войти: ${err.message}`);
      }
    }
  }

  function logout() {
    state.token = null;
    state.tasks = [];
    storage.remove(TOKEN_KEY);
    els.list.replaceChildren();
    els.authorBox.hidden = true;
    els.tasksSection.hidden = true;
    els.loginSection.hidden = false;
  }

  async function addTask() {
    const result = validateTitle(els.addInput.value);
    if (result.error) {
      setFieldError(els.addInput, els.addError, result.error);
      els.addInput.focus();
      return;
    }
    setFieldError(els.addInput, els.addError, '');
    hideAlert();
    const submit = els.addForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const task = await api('POST', '/api/tasks/', { title: result.title, runId: state.runId });
      state.tasks.push(task);
      els.list.append(createTaskItem(task));
      renderSummary();
      els.addInput.value = '';
      announce(`Дело «${task.title}» добавлено.`);
    } catch (err) {
      handleApiError(err, 'Не удалось добавить дело');
    } finally {
      submit.disabled = false;
      if (state.token) els.addInput.focus();
    }
  }

  async function toggleTask(li, checkbox) {
    const id = li.dataset.id;
    const done = checkbox.checked;
    checkbox.disabled = true;
    hideAlert();
    try {
      const task = await api('PATCH', `/api/tasks/${id}/`, { done });
      replaceTask(task);
      announce(task.done ? `«${task.title}» — выполнено.` : `«${task.title}» — снова в работе.`);
    } catch (err) {
      checkbox.checked = !done;
      handleApiError(err, 'Не удалось изменить отметку');
    } finally {
      checkbox.disabled = false;
      if (state.token && document.activeElement === document.body) checkbox.focus();
    }
  }

  function openEdit(li) {
    const task = state.tasks.find((t) => t.id === li.dataset.id);
    const view = li.querySelector('.task__view');
    const form = li.querySelector('.task__edit');
    const input = form.querySelector('.input');
    input.value = task ? task.title : '';
    setFieldError(input, form.querySelector('.task__edit-error'), '');
    view.hidden = true;
    form.hidden = false;
    input.focus();
    input.select();
  }

  function closeEdit(li) {
    li.querySelector('.task__edit').hidden = true;
    li.querySelector('.task__view').hidden = false;
    li.querySelector('[data-action="edit"]').focus();
  }

  async function saveEdit(li) {
    const form = li.querySelector('.task__edit');
    const input = form.querySelector('.input');
    const errorEl = form.querySelector('.task__edit-error');
    const result = validateTitle(input.value);
    if (result.error) {
      setFieldError(input, errorEl, result.error);
      input.focus();
      return;
    }
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    hideAlert();
    try {
      const task = await api('PATCH', `/api/tasks/${li.dataset.id}/`, { title: result.title });
      replaceTask(task);
      closeEdit(li);
      announce(`Название изменено на «${task.title}».`);
    } catch (err) {
      handleApiError(err, 'Не удалось сохранить название');
      if (state.token) input.focus();
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  async function deleteTask(li) {
    const id = li.dataset.id;
    const task = state.tasks.find((t) => t.id === id);
    const button = li.querySelector('[data-action="delete"]');
    button.disabled = true;
    hideAlert();
    try {
      await api('DELETE', `/api/tasks/${id}/`);
      // Фокус переходит на соседнее дело, чтобы не потеряться на странице.
      const neighbour = li.nextElementSibling || li.previousElementSibling;
      state.tasks = state.tasks.filter((t) => t.id !== id);
      li.remove();
      renderSummary();
      (neighbour ? neighbour.querySelector('.task__check') : els.addInput).focus();
      announce(`Дело «${task ? task.title : ''}» удалено.`);
    } catch (err) {
      button.disabled = false;
      if (err.status === 404) {
        // Дело уже удалили (например, напрямую в БД) — синхронизируем список.
        announce('Это дело уже удалено. Список обновлен.');
        await loadTasks();
        els.addInput.focus();
      } else {
        handleApiError(err, 'Не удалось удалить дело');
      }
    }
  }

  // ---------- события ----------
  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = els.tokenInput.value.trim();
    if (!token) {
      setFieldError(els.tokenInput, els.tokenError, 'Введите токен.');
      els.tokenInput.focus();
      return;
    }
    login(token);
  });

  els.logoutButton.addEventListener('click', () => {
    logout();
    els.tokenInput.focus();
    announce('Вы вышли.');
  });

  els.runForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const runId = els.runInput.value.trim();
    if (!RUN_ID_RE.test(runId)) {
      setFieldError(els.runInput, els.runError, 'Только латиница, цифры, «_» и «-», от 1 до 64 символов.');
      els.runInput.focus();
      return;
    }
    setFieldError(els.runInput, els.runError, '');
    hideAlert();
    state.runId = runId;
    storage.set(RUN_KEY, runId);
    if (await loadTasks()) announce(`Показан набор «${runId}»: дел ${state.tasks.length}.`);
  });

  els.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addTask();
  });

  els.list.addEventListener('change', (event) => {
    if (event.target.matches('.task__check')) {
      toggleTask(event.target.closest('li'), event.target);
    }
  });

  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const li = button.closest('li');
    if (button.dataset.action === 'edit') openEdit(li);
    if (button.dataset.action === 'cancel') closeEdit(li);
    if (button.dataset.action === 'delete') deleteTask(li);
  });

  els.list.addEventListener('submit', (event) => {
    if (event.target.matches('.task__edit')) {
      event.preventDefault();
      saveEdit(event.target.closest('li'));
    }
  });

  els.list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target.closest('.task__edit')) {
      event.preventDefault();
      closeEdit(event.target.closest('li'));
    }
  });

  // ---------- старт ----------
  state.runId = storage.get(RUN_KEY) || 'manual';
  els.runInput.value = state.runId;
  const savedToken = storage.get(TOKEN_KEY);
  if (savedToken) login(savedToken, { silent: true });
})();
