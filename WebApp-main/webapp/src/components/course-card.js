export default function CourseCard({ title, description}) {
    return (
      <div className="group relative rounded-lg border bg-[#1C1C1C] p-6 hover:bg-[#242424] transition-colors">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm text-gray-400">{description}</p>
      </div>
    );
  }
  
  