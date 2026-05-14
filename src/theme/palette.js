// Ported from VMConsoleFrontEnd `defaultVariant`. Single-variant for V1
// (theme switcher dropped — was unused in PM views). Guide editorial
// cream/copper palette intentionally excluded.

const customBlue = {
  50: "#e9f0fb",
  100: "#c8daf4",
  200: "#a3c1ed",
  300: "#7ea8e5",
  400: "#6395e0",
  500: "#4782da",
  600: "#407ad6",
  700: "#376fd0",
  800: "#2f65cb",
  900: "#2052c2",
};

const palette = {
  mode: "light",
  primary: {
    main: customBlue[700],
    contrastText: "#FFFFFF",
  },
  secondary: {
    main: customBlue[500],
    contrastText: "#FFFFFF",
  },
  background: {
    default: "#F7F9FC",
    paper: "#FFFFFF",
  },
  customBlue,
};

export default palette;
