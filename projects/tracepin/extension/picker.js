(() => {
  if (window.__tracePinPickerActive) return;
  window.__tracePinPickerActive = true;
  let target = null;
  let previousOutline = "";

  const node = (tag, props = {}, children = []) => {
    const element = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => key === "className" ? element.className = value : key === "text" ? element.textContent = value : element.setAttribute(key, value));
    children.forEach((child) => element.append(child));
    return element;
  };

  const root = node("div", { id: "tracepin-root" });
  const style = node("style");
  style.textContent = `#tracepin-root{position:fixed;z-index:2147483647;inset:0;pointer-events:none;font-family:Arial,sans-serif;color:#17191c}#tracepin-toolbar{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#20252a;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 14px 34px #0003}#tracepin-card{position:fixed;right:18px;top:18px;width:340px;background:#f3f3ee;border:1px solid #30353a33;box-shadow:0 24px 60px #0004;padding:18px;pointer-events:auto}#tracepin-card h2{font-size:16px;margin:0 0 15px}#tracepin-card label{display:block;font-size:10px;color:#747a7b;margin:10px 0 5px}#tracepin-card input,#tracepin-card textarea,#tracepin-card select{width:100%;box-sizing:border-box;border:1px solid #252a3033;background:#fff;padding:9px;color:#17191c;font:12px Arial}#tracepin-card textarea{min-height:70px;resize:vertical}#tracepin-card .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}#tracepin-card .actions{display:flex;justify-content:flex-end;gap:7px;margin-top:14px}#tracepin-card button{border:1px solid #252a3033;background:transparent;padding:9px 12px;font:11px Arial}#tracepin-card button[data-primary]{background:#20252a;color:white;border-color:#20252a}#tracepin-card .warning{font-size:10px;line-height:1.4;color:#8b5d42;margin-top:10px}`;
  document.documentElement.append(style, root);
  const toolbar = node("div", { id: "tracepin-toolbar", text: "TracePin · выберите элемент · Esc — отмена" });
  root.append(toolbar);

  const safeTarget = (element) => element instanceof Element && !element.closest("#tracepin-root") && !element.matches("input,textarea,[contenteditable=true]") && element.getAttribute("type") !== "password";
  const textOf = (element) => (window.getSelection()?.toString() || element.innerText || element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 4000);

  function locatorOf(element) {
    const testId = element.getAttribute("data-testid");
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ").slice(0, 500);
  }

  function cleanup() {
    if (target) target.style.outline = previousOutline;
    root.remove(); style.remove(); window.__tracePinPickerActive = false;
    document.removeEventListener("mouseover", hover, true); document.removeEventListener("click", choose, true); document.removeEventListener("keydown", keydown, true);
  }

  function hover(event) {
    if (!safeTarget(event.target) || root.querySelector("#tracepin-card")) return;
    if (target) target.style.outline = previousOutline;
    target = event.target; previousOutline = target.style.outline; target.style.outline = "2px dashed #536f84";
  }

  function showCard(element) {
    toolbar.remove();
    const exact = textOf(element);
    if (exact.length < 4) return cleanup();
    const type = node("select", {}, [node("option", { value: "text", text: "Текст" }), node("option", { value: "ui", text: "Интерфейс" }), node("option", { value: "bug", text: "Ошибка" }), node("option", { value: "accessibility", text: "Доступность" })]);
    const priority = node("select", {}, [node("option", { value: "normal", text: "Обычный" }), node("option", { value: "important", text: "Важно" }), node("option", { value: "blocker", text: "Блокирует" })]);
    const tags = node("input", { placeholder: "hero, mobile, text" });
    const note = node("textarea", { placeholder: "Что нужно изменить?" });
    const sensitive = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(exact) || /(?:\+?\d[\s()-]*){10,}/u.test(exact);
    const confirm = node("input", { type: "checkbox" });
    const cancel = node("button", { type: "button", text: "Отмена" });
    const save = node("button", { type: "button", text: "Сохранить", "data-primary": "" });
    const card = node("div", { id: "tracepin-card" }, [node("h2", { text: "Новая правка" }), node("label", { text: exact.slice(0, 160) }), node("div", { className: "row" }, [node("div", {}, [node("label", { text: "Тип" }), type]), node("div", {}, [node("label", { text: "Приоритет" }), priority])]), node("label", { text: "Теги" }), tags, node("label", { text: "Комментарий" }), note]);
    if (sensitive) card.append(node("div", { className: "warning" }, [confirm, document.createTextNode(" Текст похож на персональные данные. Подтверждаю локальное сохранение.")]));
    card.append(node("div", { className: "actions" }, [cancel, save])); root.append(card);
    cancel.addEventListener("click", cleanup);
    save.addEventListener("click", async () => {
      if (sensitive && !confirm.checked) return;
      save.disabled = true;
      const response = await chrome.runtime.sendMessage({ type: "SAVE_PIN", input: { quote: exact, label: element.getAttribute("aria-label") || element.tagName.toLowerCase(), title: document.title, url: location.href, note: note.value, tags: tags.value, type: type.value, priority: priority.value, viewport: { width: innerWidth, height: innerHeight }, anchor: { exact, locator: locatorOf(element) } } });
      if (!response?.ok) { save.disabled = false; save.textContent = "Ошибка"; return; }
      cleanup();
    });
  }

  function choose(event) { if (!safeTarget(event.target) || root.querySelector("#tracepin-card")) return; event.preventDefault(); event.stopPropagation(); showCard(event.target); }
  function keydown(event) { if (event.key === "Escape") cleanup(); }
  document.addEventListener("mouseover", hover, true); document.addEventListener("click", choose, true); document.addEventListener("keydown", keydown, true);
})();
