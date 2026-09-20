'use client'
import { useScene } from '@pascal-app/core'
import { type ReactNode, useRef, useState } from 'react'
import type { NavigationMarker, PhysicalRole } from '../lib/normalization-types'
import { applyRoboticsEdit, editableRobotics, type RoboticsEdit } from '../lib/robotics-sidecar'

// The iframe intentionally has no allow-forms capability. These are local
// metadata operations; buttons collect validated controls without navigation.
function MetadataForm({
  children,
  label,
  onApply,
}: {
  children?: ReactNode
  label: string
  onApply: (data: FormData) => void
}) {
  const root = useRef<HTMLFieldSetElement>(null)
  const apply = () => {
    const data = new FormData()
    for (const control of root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input,select',
    ) ?? []) {
      if (!control.reportValidity()) return
      if (control.name) data.append(control.name, control.value)
    }
    onApply(data)
  }
  return (
    <fieldset
      ref={root}
      aria-label={label}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
    >
      {children}
      <button
        type="button"
        onClick={apply}
        style={{ border: '1px solid #aaa', padding: '4px 8px', borderRadius: 4 }}
      >
        {label}
      </button>
    </fieldset>
  )
}

export function RoboticsPanel({
  value,
  readOnly,
  onChange,
}: {
  value: unknown
  readOnly: boolean
  onChange: (value: unknown) => Promise<void>
}) {
  const nodes = useScene((state) => state.nodes)
  const metadata = editableRobotics(value)
  const [notice, setNotice] = useState('')
  const [markerId, setMarkerId] = useState('')
  const selected = metadata.navigation.markers.find((marker) => marker.id === markerId)
  const choices = Object.values(nodes).filter((node) => !['building', 'level'].includes(node.type))
  const submit = (data: FormData, edit: (data: FormData) => RoboticsEdit) => {
    if (readOnly || useScene.getState().readOnly) {
      setNotice('Editing is temporarily locked; retry after the editor is ready.')
      return
    }
    try {
      const updated = applyRoboticsEdit(value, edit(data))
      setNotice('Saving robotics metadata…')
      void onChange(updated).then(
        () => setNotice('Robotics metadata saved'),
        () => setNotice('Save failed; metadata remains in this tab'),
      )
    } catch {
      setNotice('Enter finite coordinates, dimensions and valid marker identities.')
    }
  }
  const number = (data: FormData, key: string) => {
    const raw = String(data.get(key) ?? '').trim()
    if (!raw) throw new Error('INVALID')
    return Number(raw)
  }
  const nav = metadata.navigation
  return (
    <details
      style={{
        background: 'white',
        color: '#111',
        borderTop: '1px solid #aaa',
        padding: 8,
        maxHeight: 260,
        overflow: 'auto',
      }}
    >
      <summary>Robotics metadata · metres, right-handed Z-up · environment only</summary>
      <fieldset disabled={readOnly} style={{ display: 'grid', gap: 10 }}>
        <MetadataForm
          label="Apply reviewed role"
          onApply={(data) =>
            submit(data, (data) => ({
              kind: 'role',
              sourceId: String(data.get('source')),
              role: String(data.get('role')) as PhysicalRole,
            }))
          }
        >
          <label>
            Object{' '}
            <select name="source" required>
              {choices.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name || node.id} (
                  {typeof metadata.roles[node.id] === 'string'
                    ? metadata.roles[node.id]
                    : 'unreviewed'}
                  )
                </option>
              ))}
            </select>
          </label>
          <label>
            Physical role{' '}
            <select name="role">
              <option value="STATIC_SOLID">Static solid</option>
              <option value="SUPPORT_SURFACE">Support slab</option>
              <option value="VISUAL_ONLY">Visual only</option>
            </select>
          </label>
        </MetadataForm>
        <MetadataForm
          label="Save navigation region"
          key={JSON.stringify({ ...nav, markers: undefined })}
          onApply={(data) =>
            submit(data, (data) => ({
              kind: 'navigation',
              navigation: {
                supportSourceObjectId: String(data.get('support')),
                minimumXY: [number(data, 'minX'), number(data, 'minY')],
                maximumXY: [number(data, 'maxX'), number(data, 'maxY')],
                robotHeightM: number(data, 'height'),
                verticalMarginM: number(data, 'vertical'),
                footprintRadiusM: number(data, 'radius'),
                horizontalMarginM: number(data, 'horizontal'),
              },
            }))
          }
        >
          <label>
            Support slab{' '}
            <select name="support" defaultValue={nav.supportSourceObjectId ?? ''} required>
              <option value="">Choose support</option>
              {choices
                .filter((node) => node.type === 'slab')
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name || node.id}
                  </option>
                ))}
            </select>
          </label>
          {(
            [
              ['minX', 'Min X', nav.minimumXY?.[0]],
              ['minY', 'Min Y', nav.minimumXY?.[1]],
              ['maxX', 'Max X', nav.maximumXY?.[0]],
              ['maxY', 'Max Y', nav.maximumXY?.[1]],
              ['height', 'Robot clearance height', nav.robotHeightM],
              ['vertical', 'Vertical margin', nav.verticalMarginM],
              ['radius', 'Footprint radius', nav.footprintRadiusM],
              ['horizontal', 'Horizontal margin', nav.horizontalMarginM],
            ] as const
          ).map(([name, label, current]) => (
            <label key={name}>
              {label}{' '}
              <input
                name={name}
                type="number"
                step="any"
                required
                defaultValue={current}
                style={{ width: 75, border: '1px solid #aaa', borderRadius: 3, padding: 3 }}
              />
            </label>
          ))}
        </MetadataForm>
        <label>
          Marker{' '}
          <select value={markerId} onChange={(event) => setMarkerId(event.target.value)}>
            <option value="">New marker</option>
            {nav.markers.map((marker) => (
              <option key={marker.id} value={marker.id}>
                {marker.kind} #{marker.id}
              </option>
            ))}
          </select>
        </label>
        <MetadataForm
          label={markerId ? 'Update marker' : 'Add marker'}
          key={`${markerId}:${JSON.stringify(selected)}`}
          onApply={(data) =>
            submit(data, (data) => ({
              kind: 'marker',
              ...(markerId ? { id: markerId } : {}),
              marker: {
                kind: String(data.get('kind')) as NavigationMarker['kind'],
                position: [number(data, 'x'), number(data, 'y'), number(data, 'z')],
                yawRadians: number(data, 'yaw'),
              },
            }))
          }
        >
          <label>
            Kind{' '}
            <select name="kind" defaultValue={selected?.kind ?? 'ROBOT_SPAWN'}>
              <option value="ROBOT_SPAWN">Robot spawn</option>
              <option value="HOME">Home</option>
              <option value="TOUR_POINT">Tour point</option>
            </select>
          </label>
          {(['x', 'y', 'z', 'yaw'] as const).map((name, index) => (
            <label key={name}>
              {name === 'yaw' ? 'Yaw (radians)' : `${name.toUpperCase()} (metres)`}{' '}
              <input
                name={name}
                type="number"
                step="any"
                required
                defaultValue={index < 3 ? selected?.position[index] : selected?.yawRadians}
                style={{ width: 75, border: '1px solid #aaa', borderRadius: 3, padding: 3 }}
              />
            </label>
          ))}
          <span>Frame: ROM_SCENE</span>
        </MetadataForm>
        {markerId && (
          <MetadataForm
            label="Remove selected marker"
            onApply={(data) => {
              submit(data, () => ({ kind: 'remove-marker', id: markerId }))
              setMarkerId('')
            }}
          ></MetadataForm>
        )}
      </fieldset>
      <p role="status">
        {notice ||
          'Every physical object needs an explicit reviewed role. Incomplete metadata can be saved; builds report missing fields.'}
      </p>
    </details>
  )
}
