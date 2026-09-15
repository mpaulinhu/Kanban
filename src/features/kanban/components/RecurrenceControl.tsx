import type { CSSProperties } from 'react'
import type { RecurrenceConfig } from '../types/pmOffice'

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const

const INTERVAL_LABEL: Record<Exclude<RecurrenceConfig['pattern'], 'custom-days'>, string> = {
  daily: 'A cada (dias)',
  weekly: 'A cada (semanas)',
  monthly: 'A cada (meses)',
  'business-days': 'A cada (dias úteis)',
}

export interface RecurrenceControlProps {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  pattern: RecurrenceConfig['pattern']
  onPatternChange: (p: RecurrenceConfig['pattern']) => void
  interval: number
  onIntervalChange: (n: number) => void
  days: number[]
  onDaysChange: (days: number[]) => void
}

export function RecurrenceControl({
  enabled,
  onEnabledChange,
  pattern,
  onPatternChange,
  interval,
  onIntervalChange,
  days,
  onDaysChange,
}: RecurrenceControlProps) {
  const inputBase: CSSProperties = {
    padding: '6px 10px',
    border: '1px solid var(--eh-border)',
    borderRadius: 7,
    fontSize: 13,
    fontFamily: 'inherit',
    color: 'var(--eh-text)',
    background: 'var(--eh-surface)',
    outline: 'none',
  }

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--eh-text-3)',
    marginBottom: 5,
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="task-recurrence-toggle"
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          style={{ cursor: 'pointer', width: 14, height: 14, flexShrink: 0 }}
        />
        <label
          htmlFor="task-recurrence-toggle"
          style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--eh-text)', cursor: 'pointer', userSelect: 'none' }}
        >
          Repetir esta tarefa
        </label>
      </div>
      {enabled && (
        <div style={{ marginTop: 10, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label htmlFor="task-recurrence-pattern" style={labelStyle}>
              Padrão
            </label>
            <select
              id="task-recurrence-pattern"
              value={pattern}
              onChange={(e) => onPatternChange(e.target.value as RecurrenceConfig['pattern'])}
              style={{ ...inputBase, maxWidth: 220, cursor: 'pointer' }}
            >
              <option value="daily">Diária</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
              <option value="business-days">Dias úteis</option>
              <option value="custom-days">Dias da semana</option>
            </select>
          </div>
          {pattern === 'custom-days' ? (
            <div>
              <label style={{ ...labelStyle, marginBottom: 8 }}>Dias</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DAY_LABELS.map((label, idx) => {
                  const active = days.includes(idx)
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        onDaysChange(active ? days.filter((d) => d !== idx) : [...days, idx])
                      }
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '3px 9px',
                        borderRadius: 20,
                        border: '1px solid',
                        cursor: 'pointer',
                        borderColor: active ? 'var(--eh-primary)' : 'var(--eh-border)',
                        background: active ? 'var(--eh-primary)' : 'transparent',
                        color: active ? '#fff' : 'var(--eh-text-2)',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="task-recurrence-interval" style={labelStyle}>
                {INTERVAL_LABEL[pattern]}
              </label>
              <input
                id="task-recurrence-interval"
                type="number"
                min={1}
                max={365}
                value={interval}
                onChange={(e) => onIntervalChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...inputBase, maxWidth: 80 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
