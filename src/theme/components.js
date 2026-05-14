// Component-level theme overrides. Ported from VMConsoleFrontEnd with cleanups:
//   - Dropped MuiPickers* (Console uses @mui/x-date-pickers v5; we'll
//     wire v6 fresh when needed).
//   - Removed the broken `border: 1px solid red` MuiMenu hack.

const components = {
  MuiButtonBase: {
    defaultProps: {
      disableRipple: true,
    },
  },
  MuiButton: {
    styleOverrides: {
      contained: {
        textShadow: "0 1px 1px rgba(0, 0, 0, 0.3)",
        boxShadow: "rgba(0, 0, 0, 0.05) 0 2px 4px 0",
      },
    },
  },
  MuiLink: {
    defaultProps: {
      underline: "hover",
    },
  },
  MuiCardHeader: {
    defaultProps: {
      titleTypographyProps: {
        variant: "h6",
      },
    },
    styleOverrides: {
      action: {
        marginTop: "-4px",
        marginRight: "-4px",
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 6,
        boxShadow:
          "rgba(50, 50, 93, 0.025) 0px 2px 5px -1px, rgba(0, 0, 0, 0.05) 0px 1px 3px -1px",
        backgroundImage: "none",
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        backgroundImage: "none",
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 6,
      },
      filled: {
        textShadow: "0 1px 1px rgba(0, 0, 0, 0.2)",
      },
    },
  },
  MuiMenu: {
    styleOverrides: {
      paper: ({ theme }) => ({
        border: `1px solid ${theme.palette.divider}`,
      }),
    },
  },
};

export default components;
