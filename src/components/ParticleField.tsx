import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number; // 0 = cyan, 1 = violet
}

// the proximity-link pass is O(n²) — keep the swarm small on phones so the
// field doesn't eat the battery
const SMALL_SCREEN = '(max-width: 700px)';
const COUNT_DESKTOP = 110;
const COUNT_SMALL = 36;
const LINK_DIST_DESKTOP = 110;
const LINK_DIST_SMALL = 80;

/**
 * Ambient n-body background: particles drift under the gravity of three
 * slow-moving invisible attractors, linked by proximity lines.
 */
export default function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = window.matchMedia(SMALL_SCREEN).matches;
    const count = small ? COUNT_SMALL : COUNT_DESKTOP;
    const linkDist = small ? LINK_DIST_SMALL : LINK_DIST_DESKTOP;
    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      hue: Math.random(),
    }));

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // three attractors on slow Lissajous orbits
      const attractors = [0, 1, 2].map((i) => ({
        x: w * (0.5 + 0.38 * Math.sin(t * 0.00006 + i * 2.1)),
        y: h * (0.5 + 0.38 * Math.cos(t * 0.00008 + i * 1.7)),
      }));

      for (const p of particles) {
        for (const a of attractors) {
          const dx = a.x - p.x;
          const dy = a.y - p.y;
          const d2 = Math.max(dx * dx + dy * dy, 1600);
          // attraction far out, repulsive core near the attractor — and a
          // tangential component so particles orbit instead of falling in
          // (pure attraction + damping collapses into blobs over time)
          const radial = 9 / d2 - 70000 / (d2 * d2);
          const swirl = 5 / d2;
          p.vx += (dx * radial - dy * swirl) * 0.06;
          p.vy += (dy * radial + dx * swirl) * 0.06;
        }
        // thermal jitter keeps the swarm from ever settling
        p.vx += (Math.random() - 0.5) * 0.03;
        p.vy += (Math.random() - 0.5) * 0.03;
        p.vx *= 0.996;
        p.vy *= 0.996;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 1.4) {
          p.vx *= 1.4 / speed;
          p.vy *= 1.4 / speed;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            const alpha = 0.07 * (1 - Math.sqrt(d2) / linkDist);
            ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        const speed = Math.min(Math.hypot(p.vx, p.vy) * 2, 1);
        const r = 1 + speed;
        ctx.fillStyle =
          p.hue < 0.7
            ? `rgba(34, 211, 238, ${0.25 + speed * 0.3})`
            : `rgba(139, 92, 246, ${0.3 + speed * 0.3})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduced) {
      draw(0);
    } else {
      const loop = (t: number) => {
        if (!document.hidden) draw(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-canvas" aria-hidden />;
}
