import React, { useState } from "react";
import { Sparkles, ArrowRight, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LoginProps {
  onLogin: (password: string, nickname: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1 && password.trim()) {
      setStep(2);
    } else if (step === 2 && nickname.trim()) {
      onLogin(password.trim(), nickname.trim());
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 relative bg-[#090610] overflow-hidden">
      {/* Dynamic Cinematic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] rounded-full bg-purple-900/40 mix-blend-screen animate-breathe blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-orange-600/30 mix-blend-screen animate-breathe blur-3xl pointer-events-none" style={{ animationDelay: '4s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-sm relative z-10 perspective-1000"
      >
        <motion.div
          animate={{ rotateX: 0, rotateY: 0 }}
          whileHover={{ rotateX: 2, rotateY: -2 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="glass-panel p-8 sm:p-10 rounded-[2rem] flex flex-col items-center relative overflow-hidden"
        >
          {/* Subtle top rim light */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />

          {/* Logo */}
          <div className="w-16 h-16 rounded-full bg-gradient-warm flex items-center justify-center mb-6 shadow-xl relative animate-float">
            <Sparkles className="w-8 h-8 text-white relative z-10" strokeWidth={2.5} />
            <div className="absolute inset-0 bg-white/20 rounded-full blur-md" />
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-white mb-2" style={{ fontFamily: "Outfit, system-ui, sans-serif" }}>
            Moments
          </h1>
          <p className="text-[15px] font-medium text-slate-300/80 text-center leading-relaxed mb-8">
            Connect in a fleeting, private space.
          </p>

          <form onSubmit={handleNext} className="w-full relative min-h-[140px]">
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider pl-1">
                    Entry Passphrase
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your shared secret..."
                      className="w-full px-5 py-4 rounded-2xl text-[16px] text-white placeholder-slate-500/60 outline-none transition-all glass-input focus:bg-white/10"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={!password.trim()}
                    className="w-full py-4 rounded-2xl text-[16px] font-bold text-slate-900 bg-white transition-all hover:bg-slate-200 disabled:opacity-50 flex items-center justify-center gap-2 group mt-2"
                  >
                    <span>Continue</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider pl-1">
                    Identity
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="How should they call you?"
                    className="w-full px-5 py-4 rounded-2xl text-[16px] text-white placeholder-slate-500/60 outline-none transition-all glass-input focus:bg-white/10"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={!nickname.trim()}
                    className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-gradient-warm transition-all disabled:opacity-50 disabled:grayscale mt-2 shadow-[0_4px_20px_rgba(255,126,95,0.4)]"
                  >
                    Create Moment
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </form>

          {/* Pagination dots */}
          <div className="flex gap-2 mt-8">
            <div className={`w-2 h-2 rounded-full transition-all duration-300 ${step === 1 ? 'bg-white w-4' : 'bg-white/20'}`} />
            <div className={`w-2 h-2 rounded-full transition-all duration-300 ${step === 2 ? 'bg-white w-4' : 'bg-white/20'}`} />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
