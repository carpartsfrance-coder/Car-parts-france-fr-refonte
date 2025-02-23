import React from 'react'
import Link from 'next/link'

const Hero = () => {
  return (
    <div className="relative min-h-screen flex items-center bg-gray-900 overflow-hidden">
      {/* Fond animé */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.1),transparent_50%)]" />
        
        {/* Particules/Formes */}
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-[10%] left-[5%] w-72 h-72 bg-red-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute top-[40%] right-[15%] w-96 h-96 bg-red-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute bottom-[10%] left-[25%] w-64 h-64 bg-red-500/10 rounded-full blur-3xl animate-pulse delay-2000" />
        </div>

        {/* Grille en arrière-plan */}
        <div 
          className="absolute inset-0 opacity-[0.015]" 
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px'
          }}
        />
      </div>

      {/* Badges de confiance */}
      <div className="absolute top-4 right-4 flex gap-4">
        <div className="bg-white/10 backdrop-blur-md rounded-xl px-4 py-2 flex items-center gap-2">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-white text-sm font-medium">Formation Certifiée</span>
        </div>
      </div>

      {/* Contenu principal en deux colonnes */}
      <div className="relative z-10 container mx-auto px-4 py-32 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Colonne de gauche */}
          <div>
            {/* Label promo */}
            <div className="inline-flex items-center gap-2 bg-red-500/20 backdrop-blur-sm rounded-full px-4 py-1 mb-6">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              <span className="text-red-500 font-medium">Places limitées - 4 places restantes</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Devenez expert en programmation de clés auto
            </h1>
            <p className="mt-6 text-lg leading-8 text-gray-300">
              Formation complète pour maîtriser la programmation de clés automobiles et lancer votre activité. 
              Apprenez avec des experts du domaine et accédez à un marché en pleine expansion.
            </p>

            <div className="mt-10 flex items-center gap-x-6">
              <Link
                href="/programme"
                className="rounded-xl bg-red-500 px-6 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 transition-all duration-300"
              >
                Découvrir la formation
              </Link>
              <Link
                href="#contact"
                className="text-sm font-semibold leading-6 text-white hover:text-red-400 transition-all duration-300"
              >
                Nous contacter <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          {/* Colonne de droite */}
          <div className="space-y-8">
            {/* Avantages formation en ligne */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <div>
                  <div className="text-lg font-semibold text-white">Formation 100% en ligne</div>
                  <div className="text-red-500">Accès immédiat</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-gray-300">À votre rythme</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                  <span className="text-sm text-gray-300">Accès illimité</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm text-gray-300">Support vidéo</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span className="text-sm text-gray-300">Communauté</span>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6">
                <div className="text-3xl font-bold text-red-500">98%</div>
                <div className="text-sm text-gray-400">Taux de réussite</div>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6">
                <div className="text-3xl font-bold text-red-500">150+</div>
                <div className="text-sm text-gray-400">Élèves formés</div>
              </div>
            </div>

            {/* Témoignage */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <div className="flex items-center gap-4 mb-3">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-white">Thomas D.</div>
                  <div className="text-sm text-gray-400">Ancien élève, promotion 2024</div>
                </div>
              </div>
              <p className="text-gray-300 italic">
                "Cette formation m'a permis de lancer mon activité en seulement 2 mois. 
                Le support est excellent et j'ai récupéré mon investissement en quelques semaines."
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Hero
