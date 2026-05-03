import Link from "next/link";
import type { Resource } from "@/types/site";

type ResourceCardProps = {
  resource: Resource;
};

export function ResourceCard({ resource }: ResourceCardProps) {
  return (
    <article className="section-shell section-ornament flex h-full flex-col p-6">
      <div className="relative flex h-full flex-col">
        <div className="flex flex-wrap gap-2">
          <span className="pill">{resource.category}</span>
          <span className="pill bg-brand-moss text-brand-pine">{resource.format}</span>
        </div>
        <h3 className="mt-5 text-2xl font-semibold">{resource.title}</h3>
        <p className="mt-3 flex-1">{resource.description}</p>
        <Link
          href={resource.href}
          className="mt-6 inline-flex text-sm font-semibold text-brand-forest hover:text-brand-pine"
        >
          Learn more
        </Link>
      </div>
    </article>
  );
}

