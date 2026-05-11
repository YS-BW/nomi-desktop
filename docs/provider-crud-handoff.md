# Provider CRUD Handoff For Core

Need from core:

- Goal:
  Desktop wants provider management to behave like current `remote` / `mcp` / `skill` management: listable, creatable, editable, deletable, with a clear active-provider/apply flow. Current protocol only supports viewing catalog/state plus mutating settings/active provider, which is not enough for provider CRUD UX.

- Command/Event:
  Proposed additive remote commands/events for provider CRUD.

Commands needed:

1. `list_providers`
   Request fields:
   - `type: "list_providers"`
   Response/event should return the full provider management list, distinct from read-only catalog defaults.

2. `create_provider`
   Request fields:
   - `type: "create_provider"`
   - `provider: string`
   - `display_name?: string | null`
   - `api_key?: string | null`
   - `api_base?: string | null`
   - `model?: string | null`
   - `clone_from?: string | null`
   Notes:
   - Desktop needs a way to create a new provider entry/config row.
   - If provider identity must come from a fixed backend enum instead of arbitrary name, core should define that explicitly.

3. `update_provider`
   Request fields:
   - `type: "update_provider"`
   - `provider: string`
   - `display_name?: string | null`
   - `api_key?: string | null`
   - `api_base?: string | null`
   - `model?: string | null`
   - `clear_api_key?: boolean | null`
   Notes:
   - `api_base` must remain editable only when the provider is editable for base URL.
   - Desktop expects builtin non-custom providers to show URL as visible-but-readonly.
   - `api_key` and `model` should be editable for all providers.

4. `delete_provider`
   Request fields:
   - `type: "delete_provider"`
   - `provider: string`
   Notes:
   - Need explicit semantics if deleting the current active provider is forbidden or allowed.

Existing commands still needed:

- `get_provider_state`
- `set_active_provider`
- `reload_runtime`

Proposed events needed:

1. `provider_list`
2. `provider_created`
3. `provider_updated`
4. `provider_deleted`

Existing events can remain:

- `provider_state_snapshot`
- `active_provider_changed`
- `runtime_reloaded`

- Response/Event fields:
  Desktop needs each provider management item to carry enough editable/viewable data for a CRUD panel.

Suggested shape:

```json
{
  "provider": "deepseek",
  "display_name": "DeepSeek",
  "backend": "openai_compatible",
  "builtin": true,
  "deletable": false,
  "editable": true,
  "api_key_set": true,
  "api_key_preview": "…3688",
  "api_base": "https://api.deepseek.com",
  "api_base_editable": false,
  "saved_model": "deepseek-chat",
  "default_api_base": "https://api.deepseek.com",
  "source": "config"
}
```

Desktop specifically needs:

- provider identifier
- user-facing name
- current saved model
- current `api_base` value for all providers
- whether `apiKey` exists, and explicit overwrite / clear semantics
- whether the row is builtin / deletable / editable

If returning full `api_key` plaintext is not acceptable, desktop can keep using empty-input plus preview semantics, but core must then define a first-class clear / overwrite contract.

- State semantics:

1. Provider management is remote-global, not session-local.
2. `list_providers` should return the authoritative full provider config list for the connected remote.
3. `provider_catalog` can remain the registry/default capability surface, but desktop needs a separate management list for persisted provider entries/settings.
4. Ordering should be deterministic.
   Suggested:
   - builtin first, custom after; or an explicit stable order field.
5. `set_active_provider` should still only switch active provider/model.
6. Applying changes can continue to require explicit `reload_runtime` unless core changes that behavior.
7. If `update_provider` changes the active provider’s effective config, desktop needs a flag like `requires_runtime_reload`, same as current `provider_settings_updated`.
8. If `delete_provider` targets the active provider, core should define whether:
   - it is forbidden with a business error, or
   - it is allowed and active provider falls back to another provider with a follow-up event.

- Error cases:
  Desktop needs explicit business errors with `code` + `command` and optional `fields[]` for:

- `provider_not_found`
- `provider_already_exists`
- `provider_delete_forbidden`
- `provider_builtin_not_deletable`
- `provider_api_base_not_editable`
- `provider_invalid_backend`
- `provider_invalid_name`
- `provider_model_invalid`
- `provider_api_key_required`
- `runtime_reload_busy`

Please keep field-level errors in the current shape:

```json
{
  "fields": [
    {
      "field": "api_base",
      "code": "not_editable",
      "message": "api_base is read-only for this provider"
    }
  ]
}
```

- Compatibility:
  Additive only. Existing `ready.provider_catalog`, `ready.provider_state`, `get_provider_state`, `set_provider_settings`, `set_active_provider`, `reload_runtime` can remain during transition, but desktop would prefer a consolidated CRUD-oriented provider surface once available.

- Acceptance:

1. Connect desktop to remote.
2. Open provider settings.
3. Desktop can fetch the full provider list.
4. For a builtin non-custom provider:
   - can view `api_base`
   - cannot edit `api_base`
   - can edit `apiKey`
   - can edit `model`
5. For custom provider:
   - can create
   - can edit `apiKey` / `model` / `apiBase`
   - can delete if not active or according to defined rule
6. Change the active provider/model, then reload runtime; desktop receives state/event updates and UI reflects the new active provider.
7. Delete or update operations return distinguishable business errors for forbidden cases.

Open design question for core:

- Is provider identity intended to be a fixed registry enum plus one mutable custom row, or truly multiple CRUD-able provider entries similar to MCP rows?
- Desktop can support either, but the protocol shape differs materially.
