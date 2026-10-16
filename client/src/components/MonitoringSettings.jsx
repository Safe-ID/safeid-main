import { useEffect, useState } from "react";
import { fetchMonitoringStatus, updateMonitoringPreferences } from "../lib/api";

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : null;
}

/** Liga/desliga os alertas de vazamento e mostra a última verificação automática */
export default function MonitoringSettings() {
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchMonitoringStatus()
      .then((result) => { if (active) setStatus(result); })
      .catch((err) => { if (active) setError(err.message || "Não foi possível carregar o monitoramento."); });
    return () => { active = false; };
  }, []);

  const toggle = async () => {
    if (!status) return;
    try {
      setSaving(true);
      setError("");
      setStatus(await updateMonitoringPreferences(!status.enabled));
    } catch (err) {
      setError(err.message || "Não foi possível salvar a preferência.");
    } finally {
      setSaving(false);
    }
  };

  const enabled = Boolean(status?.enabled);
  const lastCheck = formatDateTime(status?.lastMonitoredAt);

  return (
    <section aria-labelledby="monitoring-settings-title" className="bg-safe-card border border-safe-border rounded-2xl p-5 sm:p-6 mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="monitoring-settings-title" className="text-safe-text font-semibold text-base m-0">
            Alertas de novos vazamentos
          </h2>
          <p className="text-safe-muted text-sm mt-1.5 leading-relaxed">
            O SafeID confere seu email quando a base de vazamentos é atualizada e avisa aqui no sino e por email
            se ele aparecer em um vazamento novo. Seu email nunca é compartilhado.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="monitoring-settings-title"
          onClick={toggle}
          disabled={!status || saving}
          className={`relative shrink-0 w-12 h-7 rounded-full border transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60 ${
            enabled ? "bg-safe-primary border-safe-primary" : "bg-safe-border border-safe-borderL"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white transition-all ${enabled ? "left-[24px]" : "left-[3px]"}`}
          />
        </button>
      </div>

      <div className="text-safe-dim text-xs mt-4">
        {!status && !error && "Carregando..."}
        {status && (enabled ? "Alertas ligados" : "Alertas desligados")}
        {status && enabled && (lastCheck ? ` · Última verificação automática: ${lastCheck}` : " · A primeira verificação automática acontece em breve")}
      </div>

      {error && <div role="alert" className="text-safe-danger text-[13px] mt-3">{error}</div>}
    </section>
  );
}
