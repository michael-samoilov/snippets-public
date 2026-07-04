import { type ShaderComponentProps } from '../shader-mount.js';
import { type PulsingBorderParams, type ShaderPreset } from "../../core/index";
export interface PulsingBorderProps extends ShaderComponentProps, PulsingBorderParams {
}
type PulsingBorderPreset = ShaderPreset<PulsingBorderParams>;
export declare const defaultPreset: PulsingBorderPreset;
export declare const circlePreset: PulsingBorderPreset;
export declare const northernLightsPreset: PulsingBorderPreset;
export declare const solidLinePreset: PulsingBorderPreset;
export declare const pulsingBorderPresets: PulsingBorderPreset[];
export declare const PulsingBorder: React.FC<PulsingBorderProps>;
export {};
