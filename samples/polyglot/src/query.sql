SELECT
  d.name AS department,
  COUNT(e.id) AS headcount,
  AVG(e.salary) AS mean_salary
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE e.hired_at >= DATE '2020-01-01'
GROUP BY d.name
HAVING COUNT(e.id) > 5
ORDER BY headcount DESC;
