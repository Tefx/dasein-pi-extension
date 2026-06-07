const focusLabelError = (message) => ({
  kind: "invalid-value",
  path: "sensors.focus.label",
  message,
});

const normalizeFocusLabel = (value) => String(value ?? "").trim();

const manifest = {
  description: "local manually configured focus label",
  declaredInputClasses: ["derived"],
  outputFields: [
    {
      state_key: "focus.label",
      value_type: "string",
      description: "current focus label",
      agentVisibleByDefault: true,
      uiVisibleByDefault: true,
    },
  ],
  permissions: [{ kind: "none", required: false, reason: "uses only local config" }],
  remote: {
    capable: false,
    contactsNetworkByDefault: false,
    destinations: [],
    payloadClasses: [],
    transmissionCadence: "none",
    disableControl: "none",
    description: "none",
  },
  backgroundWork: {
    capable: false,
    kinds: [],
    defaultIntervalMs: null,
    intervalRelationship: "none",
    description: "none",
  },
};

const focus = {
  key: "focus",
  defaults: {
    enabled: true,
    ui: true,
    agent: true,
    timeoutMs: 2000,
    staleAfterMs: 120000,
    initialRefresh: true,
    label: "coding",
  },
  manifest,
  fields: {
    label: {
      label: "Focus label",
      description: "Short local label exposed as the focus sensor value.",
      type: "string",
    },
  },
  validateConfig: (config) => {
    const label = normalizeFocusLabel(config.label);
    if (label.length === 0) return [focusLabelError("focus.label must not be empty")];
    if (label.length > 80) return [focusLabelError("focus.label must be at most 80 characters")];
    return [];
  },
  refresh: (context) => normalizeFocusLabel(context.config.label),
  actions: {
    set: (args) => {
      const label = normalizeFocusLabel(args.join(" "));
      if (label.length === 0) return { ok: false, message: "usage: /dasein focus set <label>" };
      if (label.length > 80) return { ok: false, message: "focus label must be at most 80 characters" };
      return {
        ok: true,
        message: `focus label: ${label}`,
        mutation: {
          backend: "ConfigManager",
          assignments: {
            "sensors.focus.label": label,
          },
        },
        data: { label },
      };
    },
  },
};

export default focus;
