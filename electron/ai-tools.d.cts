export const DESIGN_TOOLS: {
  name: string;
  description: string;
  schema: { parse(value: unknown): any };
  readOnly: boolean;
}[];
export function designTool(name: string): (typeof DESIGN_TOOLS)[number];
