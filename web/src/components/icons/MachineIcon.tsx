// MACHINE ICONS
// Purpose: one original line style icon per machine kind

import type { ReactNode } from "react"
import type { MachineKind } from "../../types"

// the floor line most icons stand on
function Ground() {
  return <path d="M4 43H44" />
}

// a weight stack, a frame with plate lines
function Stack({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const lines = []
  for (let ly = y + 6; ly < y + h - 2; ly += 6) lines.push(<path key={ly} d={`M${x} ${ly}h${w}`} strokeWidth={1.5} />)
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={1.5} />
      {lines}
    </g>
  )
}

// a thicker stroke, for seats and the main frame parts
function Thick({ d }: { d: string }) {
  return <path d={d} strokeWidth={4.5} />
}

const ICONS: Record<MachineKind, () => ReactNode> = {
  "leg-extension": () => (
    <>
      <Ground />
      <Stack x={4} y={8} w={8} h={30} />
      <Thick d="M17 31H31" />
      <Thick d="M18 29L15 13" />
      <path d="M24 32V43" />
      <path d="M31 30L36 36" />
      <circle cx={37.5} cy={37.5} r={3} />
      <circle cx={29} cy={25.5} r={2.5} />
    </>
  ),
  "leg-press": () => (
    <>
      <Ground />
      <Thick d="M8 13L13 33" />
      <Thick d="M13 34H24" />
      <path d="M8 43L14 35M22 35V43" />
      <path d="M24 33L36 25" />
      <Thick d="M34 14L41 29" />
      <path d="M40 30V43" />
    </>
  ),
  "leg-curl": () => (
    <>
      <Ground />
      <rect x={5} y={23} width={28} height={5} rx={2} />
      <path d="M10 28V43M28 28V43" />
      <path d="M33 26L39 19" />
      <circle cx={40.5} cy={16.5} r={3} />
      <path d="M33 30L39 36" />
      <circle cx={40.5} cy={38} r={2.5} />
    </>
  ),
  "hack-squat": () => (
    <>
      <Ground />
      <path d="M16 42L38 8" />
      <path d="M38 8V43" />
      <Thick d="M14 33L27 13" />
      <path d="M26 11L21 9" />
      <Thick d="M4 39L15 35" />
      <circle cx={31} cy={26} r={4} />
    </>
  ),
  "hip-abductor": () => (
    <>
      <rect x={18} y={6} width={12} height={18} rx={2} />
      <Thick d="M16 28H32" />
      <path d="M24 29V43M14 43H34" />
      <Thick d="M17 31L10 38M31 31L38 38" />
      <path d="M12 20H4M7 17L4 20L7 23M36 20H44M41 17L44 20L41 23" />
    </>
  ),
  "hip-adductor": () => (
    <>
      <rect x={18} y={6} width={12} height={18} rx={2} />
      <Thick d="M16 28H32" />
      <path d="M24 29V43M14 43H34" />
      <Thick d="M17 31L10 38M31 31L38 38" />
      <path d="M3 20H12M9 17L12 20L9 23M45 20H36M39 17L36 20L39 23" />
    </>
  ),
  "calf-raise": () => (
    <>
      <Ground />
      <rect x={16} y={36} width={16} height={7} rx={1.5} />
      <path d="M38 43V6M38 12H22" />
      <Thick d="M22 12V18M30 12V18" />
      <path d="M9 32V16M5 20L9 16L13 20" />
    </>
  ),
  "smith-machine": () => (
    <>
      <Ground />
      <path d="M9 6V43M39 6V43M9 6H39" />
      <path d="M3 21H45" />
      <rect x={11} y={14} width={4} height={14} rx={1} />
      <rect x={33} y={14} width={4} height={14} rx={1} />
      <Thick d="M17 36H31" />
      <path d="M20 37V43M28 37V43" />
    </>
  ),
  "chest-press": () => (
    <>
      <Ground />
      <Stack x={4} y={8} w={8} h={30} />
      <Thick d="M16 34H28" />
      <Thick d="M18 32L17 13" />
      <path d="M22 35V43" />
      <path d="M21 9L33 18" />
      <path d="M33 13V23" />
      <path d="M37 18H45M42 15L45 18L42 21" />
    </>
  ),
  "pec-deck": () => (
    <>
      <rect x={19} y={9} width={10} height={20} rx={2} />
      <Thick d="M17 32H31" />
      <path d="M24 33V43M14 43H34" />
      <path d="M18 11C11 11 6 14 6 21M30 11C37 11 42 14 42 21" />
      <Thick d="M6 21V31M42 21V31" />
    </>
  ),
  "incline-press": () => (
    <>
      <Ground />
      <Thick d="M10 37L22 14" />
      <Thick d="M11 38H22" />
      <path d="M17 39V43" />
      <path d="M20 19L32 13" />
      <path d="M31 9L34 17" />
      <path d="M36 12L43 6M38 6H43V11" />
    </>
  ),
  "cable-crossover": () => (
    <>
      <Ground />
      <rect x={4} y={5} width={7} height={38} rx={1.5} />
      <rect x={37} y={5} width={7} height={38} rx={1.5} />
      <circle cx={13.5} cy={9} r={2.5} />
      <circle cx={34.5} cy={9} r={2.5} />
      <path d="M14 11L21 27M34 11L27 27" />
      <path d="M19 28H23M25 28H29" strokeWidth={4} />
    </>
  ),
  "triceps-pushdown": () => (
    <>
      <Ground />
      <path d="M33 4V43M33 6H20" />
      <circle cx={20} cy={9.5} r={3} />
      <path d="M20 12.5V25" />
      <Thick d="M14 30L20 25L26 30" />
      <path d="M9 14V30M5 26L9 30L13 26" />
      <Stack x={36} y={14} w={8} h={26} />
    </>
  ),
  "assisted-dip": () => (
    <>
      <Ground />
      <path d="M10 8V43M38 8V43" />
      <Thick d="M10 17H19M38 17H29" />
      <Thick d="M15 31H33" />
      <path d="M24 42V35M21 38L24 35L27 38" />
    </>
  ),
  // seated shoulder press, side view, upright back pad, handles at shoulder height pressing up to the lever
  "shoulder-press": () => (
    <>
      <Ground />
      <Stack x={36} y={8} w={8} h={30} />
      <Thick d="M9 32H21" />
      <Thick d="M11 30L9 14" />
      <path d="M15 33V43" />
      <Thick d="M8 9H30" />
      <circle cx={8} cy={9} r={2.5} />
      <path d="M23 9V19" />
      <circle cx={23} cy={21} r={2.2} />
      <path d="M30 9H36" strokeWidth={1.5} />
    </>
  ),
  // lateral raise, front view, seat and chest pad with both arm pads lifted out to the sides
  "lateral-raise": () => (
    <>
      <Ground />
      <Thick d="M17 33H31" />
      <path d="M24 33V43M18 43H30" />
      <Thick d="M24 31V17" />
      <circle cx={24} cy={17} r={2.5} />
      <path d="M22 18L9 11M26 18L39 11" />
      <rect x={5} y={7} width={7} height={5} rx={2} transform="rotate(28 8.5 9.5)" />
      <rect x={36} y={7} width={7} height={5} rx={2} transform="rotate(-28 39.5 9.5)" />
    </>
  ),
  // rear delt (reverse fly), front view, a centre column with handles swept back, arrows showing the pull
  "rear-delt": () => (
    <>
      <Ground />
      <path d="M24 6V43M17 43H31" />
      <Thick d="M24 19V33" />
      <path d="M24 10H10M24 10H38" />
      <path d="M10 6V15M38 6V15" strokeWidth={3.5} />
      <path d="M14 22c-3-1-5-3-6-6M34 22c3-1 5-3 6-6" strokeWidth={1.5} />
      <path d="M8 16l-0.5 3.2 2.8-1.2M40 16l0.5 3.2-2.8-1.2" strokeWidth={1.5} />
    </>
  ),
  "lat-pulldown": () => (
    <>
      <Ground />
      <path d="M42 4V43M42 5H24" />
      <path d="M24 5V12" />
      <path d="M6 16Q24 9 40 16" />
      <path d="M6 16V20M40 16V20" />
      <Thick d="M18 29H29" />
      <Thick d="M16 36H31" />
      <path d="M23 37V43" />
    </>
  ),
  "seated-row": () => (
    <>
      <Ground />
      <Thick d="M7 33H18" />
      <path d="M12 34V43" />
      <Thick d="M29 30L32 40" />
      <circle cx={40} cy={37} r={3} />
      <path d="M37.5 35.5L23 27" />
      <path d="M22 23V31" />
      <path d="M15 19H4M7 16L4 19L7 22" />
    </>
  ),
  "assisted-pullup": () => (
    <>
      <Ground />
      <path d="M10 4V43M38 4V43M10 6H38" />
      <Thick d="M11 11L18 14M37 11L30 14" />
      <Thick d="M15 29H33" />
      <path d="M24 41V34M21 37L24 34L27 37" />
    </>
  ),
  "t-bar-row": () => (
    <>
      <Ground />
      <circle cx={6} cy={40} r={2} />
      <path d="M8 39L34 21" />
      <circle cx={35.5} cy={20} r={6.5} />
      <circle cx={35.5} cy={20} r={1.5} />
      <path d="M24 23L29 31" strokeWidth={3.5} />
      <path d="M16 43L18 35" />
      <Thick d="M12 34L22 31" />
    </>
  ),
  "preacher-curl": () => (
    <>
      <Ground />
      <Thick d="M7 36H17" />
      <path d="M12 37V43M27 43V30" />
      <Thick d="M18 20L32 29" />
      <path d="M28 35L31 33L34 35L37 33L40 35" strokeWidth={3} />
      <path d="M40 30Q45 19 33 13M36 11L33 13L35 16" />
    </>
  ),
  "biceps-curl": () => (
    <>
      <Ground />
      <Thick d="M7 36H17" />
      <path d="M12 37V43M27 43V30" />
      <Thick d="M19 28H31" />
      <circle cx={35} cy={27} r={4.5} />
      <circle cx={35} cy={27} r={1} />
      <path d="M37 23L42 10" />
      <path d="M38 9H46" strokeWidth={3.5} />
    </>
  ),
  treadmill: () => (
    <>
      <rect x={3} y={34} width={35} height={6} rx={3} />
      <path d="M8 40V44M34 40V44" />
      <path d="M36 34L40 13" />
      <rect x={34} y={7} width={11} height={6} rx={1.5} />
      <path d="M39 19H27" />
      <path d="M10 28H18M13 23H20" strokeWidth={1.5} />
    </>
  ),
  rower: () => (
    <>
      <path d="M4 37H32" strokeWidth={3.5} />
      <circle cx={38} cy={30} r={7} />
      <circle cx={38} cy={30} r={2} />
      <path d="M6 37V43M38 37V43M3 43H44" />
      <rect x={10} y={31} width={9} height={4} rx={1.5} />
      <Thick d="M27 36L30 28" />
      <path d="M31 30H21" />
      <path d="M20 26V34" strokeWidth={3} />
    </>
  ),
  bike: () => (
    <>
      <path d="M6 43H22M26 43H42" />
      <path d="M14 43L18 17" />
      <Thick d="M12 15H23" />
      <path d="M17 31L31 31" />
      <circle cx={31} cy={33} r={7} />
      <path d="M34 43L35 34M33 27L37 11" />
      <path d="M34 11H43" strokeWidth={3.5} />
    </>
  ),
  elliptical: () => (
    <>
      <path d="M3 42H42" />
      <circle cx={10} cy={31} r={6.5} />
      <circle cx={10} cy={31} r={1.5} />
      <path d="M12 33L33 37" />
      <Thick d="M28 37H38" />
      <path d="M38 42V12" />
      <path d="M33 5L38 22M43 6L38 22" strokeWidth={3} />
      <rect x={36} y={11} width={8} height={5} rx={1.5} />
    </>
  ),
}

export interface machineIconProps {
  kind: MachineKind
  size?: number
  className?: string
  title?: string // accessible name, leave it out when the icon is just decorative (the default)
  x?: number // position when nested inside another SVG
  y?: number
  strokeWidth?: number
}

// line art icon for a machine kind, takes its colour from currentColor
export function MachineIcon({ kind, size = 24, className, title, x, y, strokeWidth = 2.5 }: machineIconProps) {
  const Draw = ICONS[kind]
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <Draw />
    </svg>
  )
}
