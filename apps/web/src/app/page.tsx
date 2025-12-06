import { SearchBar } from '@/components/SearchBar';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <h1 className="text-6xl font-black text-white mb-8 tracking-tighter">
        brawltome.app
      </h1>
      <SearchBar />
    </main>
  );
}