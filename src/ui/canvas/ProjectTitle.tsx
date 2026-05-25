interface ProjectTitleProps {
  title: string;
}

export function ProjectTitle({ title }: ProjectTitleProps) {
  return (
    <div className="project-title" aria-hidden="true">
      {title}
    </div>
  );
}
