import { useEffect, useState } from 'react'
import { dayPalettes, defaultDayPalette, frameGeometry } from './dayChart.js'

export default function DayFrame({ map, bounds, frame, palette }) {
  const [geometry, setGeometry] = useState(null)
  const { mode, ticks, width, opacity } = frame
  useEffect(() => {
    const update = () => setGeometry(frameGeometry(map, bounds, mode, ticks))
    update()
    map.on('move', update)
    map.on('resize', update)
    return () => {
      map.off('move', update)
      map.off('resize', update)
    }
  }, [map, bounds, mode, ticks])

  if (!geometry) return null
  const ink = (dayPalettes[palette] ?? dayPalettes[defaultDayPalette]).ink
  return <svg aria-hidden="true" className="day-chart-frame"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none', opacity }}>
    <polygon points={geometry.outline.map(point => point.join(',')).join(' ')}
      fill="none" stroke={ink} strokeWidth={width} />
    {geometry.ticks.map(({ x, y, dx, dy, label }, index) => <g key={index}>
      <line x1={x} y1={y} x2={x + dx * 7} y2={y + dy * 7} stroke={ink} strokeWidth={Math.max(1, width / 2)} />
      <text x={x + dx * 31} y={y + dy * 18} fill={ink} stroke="#f6efdc" strokeWidth="2"
        paintOrder="stroke" textAnchor="middle" dominantBaseline="central" fontFamily="Georgia, serif"
        fontSize="11">{label}</text>
    </g>)}
  </svg>
}
