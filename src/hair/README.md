# Hair Customization System

_Author: Jonathan Sutton Fields._

A complete latticework agency for managing character hair and eyebrow customization in the Loom application with independent controls for hair and eyebrows.

## Architecture

This system follows the latticework agency pattern with:

- **State Machine** (`hairMachine.ts`) - XState machine for managing separate hair and eyebrow state
- **Service Layer** (`hairService.ts`) - Bridges state machine with Three.js scene and classifies objects
- **Types** (`types.ts`) - TypeScript definitions and presets
- **UI Component** (`components/hair/HairCustomizationPanel.tsx`) - React UI for customization
- **Architecture Documentation** (`ARCHITECTURE.md`) - Complete technical documentation

## Features

### Independent Hair and Eyebrow Control

The system provides **completely separate controls** for hair and eyebrows:

- **Hair Color**: Base color, glow color, and glow intensity
- **Eyebrow Color**: Base color, glow color, and glow intensity
- **Automatic Detection**: Objects are automatically classified as hair or eyebrows based on naming patterns

### Color Customization

**RGB Color Pickers:**
- Base color picker with hex input for precise RGB values
- Glow/emissive color picker with hex input
- Glow intensity slider (0.0 to 1.0)

**Pre-defined Color Presets:**

**Natural Colors** (no glow):
- Natural Black (#1a1a1a)
- Natural Brown (#3d2817)
- Natural Blonde (#f5d76e)
- Natural Red (#8b2e16)
- Natural Gray (#808080)
- Natural White (#f0f0f0)

**Neon/Emissive Colors** (with glow):
- Neon Blue (base: #0088ff, glow: #00ffff, intensity: 0.8)
- Neon Pink (base: #ff69b4, glow: #ff1493, intensity: 0.8)
- Neon Green (base: #00ff00, glow: #00ff00, intensity: 1.0)
- Electric Purple (base: #8b00ff, glow: #ff00ff, intensity: 0.9)
- Fire Orange (base: #ff4500, glow: #ff8c00, intensity: 0.7)

### Outline/Wireframe

- Toggle wireframe outline on/off
- Customizable outline color
- Adjustable opacity (0-1)
- Real-time preview

### Individual Part Control

Each hair/eyebrow part can be:
- Shown/hidden independently
- Automatically classified as hair or eyebrow based on name
- Controlled with separate color settings

### Hair Physics (spring-damper)

- Toggle on/off in the Hair section
- Tunable sliders for stiffness, damping, head influence (inertia), gravity, response scale, idle sway, and wind
- Default tuning favors quicker, less “mushy” motion (higher stiffness/inertia, lighter damping, slightly stronger gravity)
- Physics output is applied only to registered hair meshes for lower per-frame cost

## Usage

### In the App

The hair service is automatically initialized when the character model loads. The UI panel appears in the top-right corner with collapsible sections for:

- **Hair** - Color preset, base color RGB picker, glow color RGB picker, glow intensity slider
- **Eyebrows** - Color preset, base color RGB picker, glow color RGB picker, glow intensity slider
- **Outline** - Toggle, color picker, opacity slider
- **Parts** - Show/hide individual hair and eyebrow parts

### Programmatic Control

The hair service is exposed globally for debugging:

```javascript
// Access the hair service
window.hairService

// Change hair color using preset
window.hairService.send({
  type: 'SET_HAIR_COLOR',
  hairColor: HAIR_COLOR_PRESETS.neon_blue
})

// Change eyebrow color using preset
window.hairService.send({
  type: 'SET_EYEBROW_COLOR',
  eyebrowColor: HAIR_COLOR_PRESETS.black
})

// Set hair base color only (RGB)
window.hairService.send({
  type: 'SET_HAIR_BASE_COLOR',
  baseColor: '#ff5733'
})

// Set eyebrow base color only (RGB)
window.hairService.send({
  type: 'SET_EYEBROW_BASE_COLOR',
  baseColor: '#1a1a1a'
})

// Set hair glow effect
window.hairService.send({
  type: 'SET_HAIR_GLOW',
  emissive: '#00ff00',
  intensity: 1.0
})

// Set eyebrow glow effect
window.hairService.send({
  type: 'SET_EYEBROW_GLOW',
  emissive: '#ff00ff',
  intensity: 0.5
})

// Toggle outline
window.hairService.send({
  type: 'SET_OUTLINE',
  show: true,
  color: '#00ff00',
  opacity: 1.0
})

// Hide a specific part
window.hairService.send({
  type: 'SET_PART_VISIBILITY',
  partName: 'Male_Bushy',
  visible: false
})

// Enable physics and tweak config
window.hairService.setPhysicsEnabled(true);
window.hairService.updatePhysicsConfig({
  stiffness: 7.5,
  damping: 0.18,
  inertia: 3.5,
  gravity: 12,
  responseScale: 2.5
});

// Reset to defaults
window.hairService.send({
  type: 'RESET_TO_DEFAULT'
})
```

### Subscribe to State Changes

```typescript
const unsubscribe = hairService.subscribe((state) => {
  console.log('Hair state changed:', state);
});

// Later: cleanup
unsubscribe();
```

## Events

The state machine accepts the following events:

```typescript
type HairEvent =
  // Complete hair color change (preset)
  | { type: 'SET_HAIR_COLOR'; hairColor: HairColor }

  // Complete eyebrow color change (preset)
  | { type: 'SET_EYEBROW_COLOR'; eyebrowColor: HairColor }

  // Hair base color only (RGB)
  | { type: 'SET_HAIR_BASE_COLOR'; baseColor: string }

  // Eyebrow base color only (RGB)
  | { type: 'SET_EYEBROW_BASE_COLOR'; baseColor: string }

  // Hair glow effect
  | { type: 'SET_HAIR_GLOW'; emissive: string; intensity: number }

  // Eyebrow glow effect
  | { type: 'SET_EYEBROW_GLOW'; emissive: string; intensity: number }

  // Wireframe outline
  | { type: 'SET_OUTLINE'; show: boolean; color?: string; opacity?: number }

  // Part visibility
  | { type: 'SET_PART_VISIBILITY'; partName: string; visible: boolean }

  // Part scaling
  | { type: 'SET_PART_SCALE'; partName: string; scale: number }

  // Part positioning
  | { type: 'SET_PART_POSITION'; partName: string; position: [number, number, number] }

  // Reset to defaults
  | { type: 'RESET_TO_DEFAULT' };
```

## State Structure

```typescript
type HairState = {
  hairColor: HairColor;          // Current hair color (separate from eyebrows)
  eyebrowColor: HairColor;       // Current eyebrow color (separate from hair)
  showOutline: boolean;          // Show wireframe outline?
  outlineColor: string;          // Outline color (hex)
  outlineOpacity: number;        // Outline opacity (0-1)

  parts: {
    [partName: string]: {
      name: string;
      visible: boolean;
      scale?: number;
      position?: [number, number, number];
    }
  };
};

type HairColor = {
  name: string;                  // Display name
  baseColor: string;             // Base RGB color (hex)
  emissive: string;              // Emissive glow color (hex)
  emissiveIntensity: number;     // Glow intensity (0-1)
};
```

## Integration

### Character Scene Integration

The `CharacterGLBScene` component automatically:

1. Scans the loaded model for hair objects (objects with names containing "hair", "bushy", "side_part", "eyebrow")
2. Initializes the `HairService` with found objects
3. Passes the service to the parent via `onReady` callback
4. Cleans up the service on unmount

### Object Classification

The system automatically classifies objects as hair or eyebrows based on naming patterns:

**Eyebrow Patterns** (case-insensitive):
- Contains "eyebrow"
- Contains "brow"
- Contains "male_bushy"
- Exact match: "male_bushy"

**Hair Patterns** (case-insensitive):
- Contains "hair"
- Contains "bushy" (if not already classified as eyebrow)
- Contains "side_part" or "sidepart"
- Exact match: "Side_part_wavy"

Objects classified as eyebrows will use `state.eyebrowColor`, while all other detected objects use `state.hairColor`.

## Adding New Color Presets

Edit `types.ts` and add to `HAIR_COLOR_PRESETS`:

```typescript
export const HAIR_COLOR_PRESETS: Record<string, HairColor> = {
  // ... existing presets

  my_custom_color: {
    name: 'My Custom Color',
    baseColor: '#ff00ff',
    emissive: '#ff0000',         // Glow color (always required)
    emissiveIntensity: 0.5,      // Glow intensity 0-1 (always required)
  },
};
```

**Note**: All color presets must include `emissive` and `emissiveIntensity` properties. For natural colors without glow, set `emissive: '#000000'` and `emissiveIntensity: 0`.

## Future Enhancements

- [x] Independent hair and eyebrow color control
- [x] RGB color pickers with hex input
- [x] Emissive glow controls
- [ ] Gradient/multi-color support
- [ ] Texture overlay support
- [ ] Animation (flowing/wind effects)
- [ ] Save/load presets to localStorage
- [ ] Export customization to JSON
- [ ] Integration with wind physics engine
- [ ] Hair particle system support

## Files

```
src/latticework/hair/
├── README.md                    # This file (user documentation)
├── ARCHITECTURE.md              # Technical architecture documentation
├── types.ts                     # Type definitions and color presets
├── hairMachine.ts               # XState 5.x state machine
└── hairService.ts               # Service layer (Three.js integration)

src/components/hair/
├── HairCustomizationPanel.tsx   # React UI component
└── HairCustomizationPanel.css   # Panel styles
```

## Architecture Documentation

For detailed technical documentation including:
- Data flow diagrams
- State machine event handling
- Service layer implementation
- Material color application
- Wireframe rendering
- Performance considerations
- Extension points

See [ARCHITECTURE.md](./ARCHITECTURE.md)

## Contributing

When adding new features to the hair system:

1. Update the state machine in `hairMachine.ts`
2. Add corresponding actions/events
3. Update the service layer to apply changes to Three.js objects
4. Update the UI component if needed
5. Document changes in this README
