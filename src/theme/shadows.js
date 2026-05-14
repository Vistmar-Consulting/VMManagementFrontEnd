// Soft, uniform shadow stack. Ported from VMConsoleFrontEnd.

const SOFT_SHADOW = "0px 1px 2px 0px rgba(0, 0, 0, 0.05)";

const shadows = ["none", ...Array(24).fill(SOFT_SHADOW)];

export default shadows;
