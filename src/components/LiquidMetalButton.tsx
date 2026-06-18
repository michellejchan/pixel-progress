import LiquidMetal from "@/components/rareui/LiquidMetal";

export default function LiquidMetalButton() {
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      {/* LiquidMetal masked to show only the border ring */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 4,
          padding: 2,
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <LiquidMetal
          speed={0.3}
          liquify={0.08}
          patternScale={2}
          dispersion={0.005}
          patternBlur={0.005}
          edge={0.5}
        />
      </div>

      <button
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px 32px",
          background: "#000000",
          borderRadius: 4,
          border: "2px solid transparent",
          cursor: "pointer",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          fontWeight: 500,
          fontSize: 16,
          color: "#ffffff",
          whiteSpace: "nowrap",
          lineHeight: "normal",
        }}
      >
        This is a button
      </button>
    </div>
  );
}
