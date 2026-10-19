import { ActionIcon, Button, Card, createTheme, Modal, Paper } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "indigo",
  colors: {
    indigo: [
      "#eef2ff",
      "#e0e7ff",
      "#c7d2fe",
      "#a5b4fc",
      "#818cf8",
      "#6366f1",
      "#4f46e5",
      "#4338ca",
      "#3730a3",
      "#312e81",
    ],
  },
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: "md",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  headings: { fontWeight: "650" },
  radius: { sm: "8px", md: "12px", lg: "18px", xl: "24px" },
  components: {
    Paper: Paper.extend({ styles: { root: { background: "var(--ops-surface)", borderColor: "var(--ops-border)" } } }),
    Card: Card.extend({ styles: { root: { background: "var(--ops-surface)", borderColor: "var(--ops-border)" } } }),
    Button: Button.extend({ defaultProps: { radius: "md" }, styles: { root: { fontWeight: 600 } } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: "md" } }),
    Modal: Modal.extend({ defaultProps: { radius: "lg", overlayProps: { backgroundOpacity: 0.45, blur: 4 } } }),
  },
});
