/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 表面阶梯：0=页面底 / 1=侧栏 / 2=浮层 / 3=凹槽
        ink: {
          DEFAULT: "#0d0b0a",
          1: "#100e0c",
          2: "#161311",
          3: "#1c1917",
        },
        // 文本阶梯（暗底上的对比度由深到浅递减）
        fg: {
          DEFAULT: "#f5f5f4",
          soft: "#d6d3d1",
          muted: "#a8a29e",
          faint: "#78716c",
        },
      },
      borderColor: {
        hairline: {
          DEFAULT: "rgba(255, 255, 255, 0.1)",
          strong: "rgba(255, 255, 255, 0.18)",
          hover: "rgba(255, 255, 255, 0.28)",
        },
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
        caption: ["0.6875rem", { lineHeight: "1rem" }],
        body: ["0.8125rem", { lineHeight: "1.25rem" }],
      },
      borderRadius: {
        control: "0.5rem",
        card: "0.75rem",
        panel: "1rem",
      },
      transitionDuration: {
        fast: "120ms",
        base: "160ms",
        slow: "240ms",
      },
      boxShadow: {
        panel: "0 18px 40px -12px rgba(0, 0, 0, 0.6)",
        ball: "0 10px 15px -3px rgba(245, 158, 11, 0.25)",
      },
    },
  },
  plugins: [],
};
